//! macOS menu bar panel: a small frameless popover shown under the tray icon.
//!
//! The panel is a second webview (`index.html?menubarPanel=1`) created hidden at startup, in the
//! same way as the Quick Add window. It reads and writes tasks through the same JS storage
//! adapter as every other window; Rust here only owns window lifecycle, positioning and the
//! hand-off to the main window.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Emitter, Manager};

pub(crate) const MENUBAR_PANEL_WINDOW_LABEL: &str = "menubar-panel";
const MENUBAR_PANEL_WINDOW_URL: &str = "index.html?menubarPanel=1";
const MENUBAR_PANEL_WIDTH: f64 = 380.0;
const MENUBAR_PANEL_HEIGHT: f64 = 600.0;
/// Corner radius of the native vibrancy layer; the webview container uses the same radius.
#[cfg(target_os = "macos")]
const MENUBAR_PANEL_CORNER_RADIUS: f64 = 12.0;
const MENUBAR_PANEL_SHOWN_EVENT: &str = "menubar-panel-shown";
const MENUBAR_OPEN_EVENT: &str = "menubar-open";
/// A tray click that arrives this soon after the panel hid itself on blur is the same click that
/// caused the blur, so it must not re-open the panel.
const REOPEN_GUARD_MS: u64 = 350;
/// Ignore blur events right after showing; the window may briefly lose focus while activating.
const BLUR_GRACE_MS: u64 = 250;
const SCREEN_MARGIN: f64 = 8.0;
const ICON_GAP: f64 = 4.0;

static LAST_BLUR_HIDE_MS: AtomicU64 = AtomicU64::new(0);
static LAST_SHOWN_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Work area / icon geometry in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PanelGeometry {
    pub icon_x: f64,
    pub icon_width: f64,
    pub icon_bottom: f64,
    pub window_width: f64,
    pub window_height: f64,
    pub area_x: f64,
    pub area_y: f64,
    pub area_width: f64,
    pub area_height: f64,
    pub margin: f64,
    pub gap: f64,
}

/// Centers the panel under the tray icon, then clamps it into the screen work area.
pub(crate) fn compute_panel_position(g: PanelGeometry) -> (i32, i32) {
    let desired_x = g.icon_x + g.icon_width / 2.0 - g.window_width / 2.0;
    let min_x = g.area_x + g.margin;
    let max_x = (g.area_x + g.area_width - g.window_width - g.margin).max(min_x);
    let x = desired_x.clamp(min_x, max_x);

    let desired_y = g.icon_bottom + g.gap;
    let min_y = g.area_y;
    let max_y = (g.area_y + g.area_height - g.window_height - g.margin).max(min_y);
    let y = desired_y.clamp(min_y, max_y);
    (x.round() as i32, y.round() as i32)
}

pub(crate) fn create_menubar_panel_window(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(MENUBAR_PANEL_WINDOW_LABEL).is_some() {
        return Ok(());
    }
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        MENUBAR_PANEL_WINDOW_LABEL,
        tauri::WebviewUrl::App(MENUBAR_PANEL_WINDOW_URL.into()),
    );
    if let Some(webview_dir) = crate::storage::portable_webview_data_dir() {
        let _ = std::fs::create_dir_all(&webview_dir);
        builder = builder.data_directory(webview_dir);
    }
    // A transparent window with a native vibrancy layer (like system menu bar extras). The
    // webview paints its own translucent, rounded container on top (see MenuBarPanelApp).
    #[cfg(target_os = "macos")]
    {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::{Effect, EffectState};
        builder = builder.transparent(true).effects(WindowEffectsConfig {
            effects: vec![Effect::Popover],
            state: Some(EffectState::Active),
            radius: Some(MENUBAR_PANEL_CORNER_RADIUS),
            color: None,
        });
    }
    builder
        .title("Stride")
        .inner_size(MENUBAR_PANEL_WIDTH, MENUBAR_PANEL_HEIGHT)
        .resizable(false)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map(|window| {
            let handle = app.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::Focused(focused) if *focused => {
                    log::info!("menubar panel: focused");
                }
                tauri::WindowEvent::Focused(false) => {
                    if now_ms().saturating_sub(LAST_SHOWN_MS.load(Ordering::SeqCst)) < BLUR_GRACE_MS
                    {
                        log::info!("menubar panel: blur within grace period, ignored");
                        return;
                    }
                    log::info!("menubar panel: blur, hiding");
                    if hide_panel(&handle) {
                        LAST_BLUR_HIDE_MS.store(now_ms(), Ordering::SeqCst);
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    hide_panel(&handle);
                }
                _ => {}
            });
        })
        .map_err(|error| format!("Failed to create menu bar panel window: {error}"))
}

/// Hides the panel. Returns true if it was visible.
pub(crate) fn hide_panel(app: &tauri::AppHandle) -> bool {
    let Some(window) = app.get_webview_window(MENUBAR_PANEL_WINDOW_LABEL) else {
        return false;
    };
    let was_visible = window.is_visible().unwrap_or(false);
    if was_visible {
        let _ = window.hide();
    }
    was_visible
}

fn show_panel_under_icon(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    rect: &tauri::Rect,
    click: tauri::PhysicalPosition<f64>,
) {
    let monitor = app
        .monitor_from_point(click.x, click.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let _ = window.set_size(tauri::LogicalSize::new(
        MENUBAR_PANEL_WIDTH,
        MENUBAR_PANEL_HEIGHT,
    ));
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let icon_pos = rect.position.to_physical::<f64>(scale);
        let icon_size = rect.size.to_physical::<f64>(scale);
        let area = monitor.work_area();
        let (x, y) = compute_panel_position(PanelGeometry {
            icon_x: icon_pos.x,
            icon_width: icon_size.width,
            icon_bottom: icon_pos.y + icon_size.height,
            window_width: MENUBAR_PANEL_WIDTH * scale,
            window_height: MENUBAR_PANEL_HEIGHT * scale,
            area_x: area.position.x as f64,
            area_y: area.position.y as f64,
            area_width: area.size.width as f64,
            area_height: area.size.height as f64,
            margin: SCREEN_MARGIN * scale,
            gap: ICON_GAP * scale,
        });
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
    let _ = window.set_always_on_top(true);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_visible_on_all_workspaces(true);
    LAST_SHOWN_MS.store(now_ms(), Ordering::SeqCst);
    let shown = window.show();
    let focused = window.set_focus();
    log::info!(
        "menubar panel: show requested (show_ok={} focus_ok={} visible={:?} position={:?})",
        shown.is_ok(),
        focused.is_ok(),
        window.is_visible().ok(),
        window.outer_position().ok()
    );
    let _ = window.emit(MENUBAR_PANEL_SHOWN_EVENT, ());
}

/// Left-click on the tray icon: toggle the panel under the icon. Falls back to the main window
/// when the panel window is unavailable.
pub(crate) fn toggle_panel(
    app: &tauri::AppHandle,
    rect: &tauri::Rect,
    click: tauri::PhysicalPosition<f64>,
) {
    let Some(window) = app.get_webview_window(MENUBAR_PANEL_WINDOW_LABEL) else {
        log::warn!("menubar panel: window missing on tray click, showing main window");
        crate::show_main(app);
        return;
    };
    if window.is_visible().unwrap_or(false) {
        log::info!("menubar panel: tray click while visible, hiding");
        let _ = window.hide();
        return;
    }
    if now_ms().saturating_sub(LAST_BLUR_HIDE_MS.load(Ordering::SeqCst)) < REOPEN_GUARD_MS {
        log::info!("menubar panel: tray click right after blur-hide, ignored");
        return;
    }
    show_panel_under_icon(app, &window, rect, click);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuBarOpenPayload {
    task_id: Option<String>,
    ask: Option<String>,
    open_capture: bool,
}

/// Panel replacement for the tray menu's "Lock" item (macOS has no tray menu).
#[tauri::command(async)]
pub(crate) fn menubar_lock(app: tauri::AppHandle) {
    hide_panel(&app);
    crate::app_lock::engage_from_tray(&app);
}

/// Panel replacement for the tray menu's "Quit" item (macOS has no tray menu).
#[tauri::command(async)]
pub(crate) fn menubar_quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command(async)]
pub(crate) fn hide_menubar_panel(app: tauri::AppHandle) {
    hide_panel(&app);
}

/// Opens the main window, optionally focused on a task, with text for the Assistant, or with Quick Capture open.
#[tauri::command(async)]
pub(crate) fn menubar_open_main(
    app: tauri::AppHandle,
    task_id: Option<String>,
    ask: Option<String>,
    open_capture: Option<bool>,
) {
    hide_panel(&app);
    crate::show_main(&app);
    let payload = MenuBarOpenPayload {
        task_id,
        ask,
        open_capture: open_capture.unwrap_or(false),
    };
    if payload.task_id.is_some() || payload.ask.is_some() || payload.open_capture {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.emit(MENUBAR_OPEN_EVENT, payload);
        }
    }
}

/// Sets the text next to the tray icon (macOS only). Cleared while the app is locked.
#[tauri::command(async)]
pub(crate) fn set_tray_title(app: tauri::AppHandle, title: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let Some(tray) = app.tray_by_id("main") else {
            return Ok(());
        };
        let title = title
            .filter(|_| !crate::app_lock::is_locked())
            .filter(|value| !value.trim().is_empty());
        tray.set_title(title.as_deref()).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&app, &title);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry() -> PanelGeometry {
        PanelGeometry {
            icon_x: 1000.0,
            icon_width: 40.0,
            icon_bottom: 50.0,
            window_width: 760.0,
            window_height: 1120.0,
            area_x: 0.0,
            area_y: 50.0,
            area_width: 2880.0,
            area_height: 1800.0,
            margin: 16.0,
            gap: 8.0,
        }
    }

    #[test]
    fn centers_under_the_icon() {
        // icon center 1020 - half width 380 = 640; y = icon bottom + gap
        assert_eq!(compute_panel_position(geometry()), (640, 58));
    }

    #[test]
    fn clamps_to_the_right_edge() {
        let g = PanelGeometry { icon_x: 2800.0, ..geometry() };
        assert_eq!(compute_panel_position(g).0, 2880 - 760 - 16);
    }

    #[test]
    fn clamps_to_the_left_edge() {
        let g = PanelGeometry { icon_x: -100.0, ..geometry() };
        assert_eq!(compute_panel_position(g).0, 16);
    }

    #[test]
    fn never_goes_above_the_work_area() {
        let g = PanelGeometry { icon_bottom: 0.0, gap: 0.0, ..geometry() };
        assert_eq!(compute_panel_position(g).1, 50);
    }

    #[test]
    fn clamps_to_the_bottom_edge_on_short_screens() {
        let g = PanelGeometry { area_height: 900.0, ..geometry() };
        assert_eq!(compute_panel_position(g).1, 50);
    }
}
