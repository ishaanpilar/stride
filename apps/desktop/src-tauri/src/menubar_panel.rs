//! Menu bar / tray panel: a small frameless popover shown next to the tray icon.
//!
//! - macOS: left click on the status item toggles the panel under the icon (native vibrancy).
//! - Windows: left click on the notification-area icon toggles the panel, above the icon when the
//!   taskbar is at the bottom (or beside/below it for other taskbar edges). Right click keeps the menu.
//! - Linux: tray click events are unreliable with libappindicator, so the tray menu has an
//!   "Open panel" item that shows the panel near the top-right of the work area.
//!
//! The panel is a second webview (`index.html?menubarPanel=1`) created hidden at startup, in the
//! same way as the Quick Add window. It reads and writes tasks through the same JS storage
//! adapter as every other window; Rust here only owns window lifecycle, positioning and the
//! hand-off to the main window.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Emitter, Manager};

pub(crate) const MENUBAR_PANEL_WINDOW_LABEL: &str = "menubar-panel";
const MENUBAR_PANEL_WINDOW_URL: &str = "index.html?menubarPanel=1";
const MENUBAR_PANEL_WIDTH: f64 = 380.0;
const MENUBAR_PANEL_HEIGHT: f64 = 600.0;
/// The user can drag the panel's bottom edge between these bounds (logical px).
const MENUBAR_PANEL_MIN_HEIGHT: f64 = 420.0;
/// Space kept free below the panel when it is at its tallest.
const SCREEN_BOTTOM_MARGIN: f64 = 40.0;
const MENUBAR_PANEL_STATE_FILE: &str = "menubar-panel.json";
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
/// Logical panel height as f64 bits; 0 means "not loaded yet".
static PANEL_HEIGHT_BITS: AtomicU64 = AtomicU64::new(0);
/// True while the user drags the bottom edge: a blur must not hide the panel mid-drag.
static RESIZING: AtomicBool = AtomicBool::new(false);
static LAST_RESIZE_END_MS: AtomicU64 = AtomicU64::new(0);

/// Clamps a requested logical height into [min, max]; non-finite input falls back to the default.
pub(crate) fn clamp_panel_height(requested: f64, min: f64, max: f64) -> f64 {
    let max = max.max(min);
    let value = if requested.is_finite() { requested } else { MENUBAR_PANEL_HEIGHT };
    value.clamp(min, max)
}

/// Tallest allowed panel for a work area of `area_height_logical` (menu bar already excluded).
pub(crate) fn max_panel_height(area_height_logical: f64) -> f64 {
    (area_height_logical - ICON_GAP - SCREEN_BOTTOM_MARGIN).max(MENUBAR_PANEL_MIN_HEIGHT)
}

pub(crate) fn parse_saved_height(raw: &str) -> Option<f64> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let height = value.get("height")?.as_f64()?;
    height.is_finite().then_some(height)
}

pub(crate) fn serialize_height(height: f64) -> String {
    serde_json::json!({ "height": height }).to_string()
}

fn state_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(MENUBAR_PANEL_STATE_FILE))
}

/// The remembered logical height (unclamped to the screen; callers clamp per monitor).
fn stored_height(app: &tauri::AppHandle) -> f64 {
    let bits = PANEL_HEIGHT_BITS.load(Ordering::SeqCst);
    if bits != 0 {
        return f64::from_bits(bits);
    }
    let loaded = state_file(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| parse_saved_height(&raw))
        .map(|h| clamp_panel_height(h, MENUBAR_PANEL_MIN_HEIGHT, 4000.0))
        .unwrap_or(MENUBAR_PANEL_HEIGHT);
    PANEL_HEIGHT_BITS.store(loaded.to_bits(), Ordering::SeqCst);
    loaded
}

fn persist_height(app: &tauri::AppHandle, height: f64) {
    if let Some(path) = state_file(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, serialize_height(height));
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Where the panel sits relative to the tray icon.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PanelPlacement {
    /// Under the icon (menu bar / taskbar at the top).
    Below,
    /// Above the icon (taskbar at the bottom).
    Above,
    /// To the right of the icon (taskbar at the left edge).
    RightOf,
    /// To the left of the icon (taskbar at the right edge).
    LeftOf,
    /// Top-right corner of the work area; the icon position is ignored (Linux).
    TopRightCorner,
}

/// Which screen edge holds the taskbar / panel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TaskbarEdge {
    Top,
    Bottom,
    Left,
    Right,
}

/// Work area / icon geometry in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PanelGeometry {
    pub placement: PanelPlacement,
    pub icon_x: f64,
    pub icon_y: f64,
    pub icon_width: f64,
    pub icon_height: f64,
    pub window_width: f64,
    pub window_height: f64,
    pub area_x: f64,
    pub area_y: f64,
    pub area_width: f64,
    pub area_height: f64,
    pub margin: f64,
    pub gap: f64,
}

/// Placement for a taskbar on `edge`: the panel opens away from the edge, towards the screen.
pub(crate) fn placement_for_taskbar(edge: TaskbarEdge) -> PanelPlacement {
    match edge {
        TaskbarEdge::Bottom => PanelPlacement::Above,
        TaskbarEdge::Top => PanelPlacement::Below,
        TaskbarEdge::Left => PanelPlacement::RightOf,
        TaskbarEdge::Right => PanelPlacement::LeftOf,
    }
}

/// Finds the taskbar edge by comparing a monitor's full rect with its work area (both physical
/// px, `(x, y, width, height)`): the edge with the largest inset is the taskbar. With an
/// auto-hidden taskbar the insets are all zero, so the edge nearest the icon centre is used.
pub(crate) fn detect_taskbar_edge(
    monitor: (f64, f64, f64, f64),
    work: (f64, f64, f64, f64),
    icon_center: (f64, f64),
) -> TaskbarEdge {
    let top = work.1 - monitor.1;
    let left = work.0 - monitor.0;
    let bottom = (monitor.1 + monitor.3) - (work.1 + work.3);
    let right = (monitor.0 + monitor.2) - (work.0 + work.2);
    let largest = top.max(bottom).max(left).max(right);
    if largest > 0.5 {
        // Ties favour bottom, then top, then left/right (the Windows default is bottom).
        return if bottom >= largest {
            TaskbarEdge::Bottom
        } else if top >= largest {
            TaskbarEdge::Top
        } else if left >= largest {
            TaskbarEdge::Left
        } else {
            TaskbarEdge::Right
        };
    }
    let to_top = (icon_center.1 - monitor.1).abs();
    let to_bottom = (monitor.1 + monitor.3 - icon_center.1).abs();
    let to_left = (icon_center.0 - monitor.0).abs();
    let to_right = (monitor.0 + monitor.2 - icon_center.0).abs();
    let nearest = to_top.min(to_bottom).min(to_left).min(to_right);
    if to_bottom <= nearest {
        TaskbarEdge::Bottom
    } else if to_top <= nearest {
        TaskbarEdge::Top
    } else if to_left <= nearest {
        TaskbarEdge::Left
    } else {
        TaskbarEdge::Right
    }
}

/// Positions the panel next to the tray icon (or in the corner), clamped into the work area.
pub(crate) fn compute_panel_position(g: PanelGeometry) -> (i32, i32) {
    let min_x = g.area_x + g.margin;
    let max_x = (g.area_x + g.area_width - g.window_width - g.margin).max(min_x);
    let min_y = g.area_y;
    let max_y = (g.area_y + g.area_height - g.window_height - g.margin).max(min_y);
    let centered_x = g.icon_x + g.icon_width / 2.0 - g.window_width / 2.0;
    let centered_y = g.icon_y + g.icon_height / 2.0 - g.window_height / 2.0;
    let (x, y) = match g.placement {
        PanelPlacement::Below => (centered_x, g.icon_y + g.icon_height + g.gap),
        PanelPlacement::Above => (centered_x, g.icon_y - g.gap - g.window_height),
        PanelPlacement::RightOf => (g.icon_x + g.icon_width + g.gap, centered_y),
        PanelPlacement::LeftOf => (g.icon_x - g.gap - g.window_width, centered_y),
        PanelPlacement::TopRightCorner => (max_x, min_y + g.margin),
    };
    let x = x.clamp(min_x, max_x);
    let y = y.clamp(min_y, max_y);
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
            crate::install_renderer_recovery(&window);
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
                    if RESIZING.load(Ordering::SeqCst)
                        || now_ms().saturating_sub(LAST_RESIZE_END_MS.load(Ordering::SeqCst)) < BLUR_GRACE_MS
                    {
                        log::info!("menubar panel: blur during resize, ignored");
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

/// Where the icon is, when known (absent for the Linux menu item).
struct IconAnchor {
    rect: tauri::Rect,
    click: tauri::PhysicalPosition<f64>,
}

fn show_panel(app: &tauri::AppHandle, window: &tauri::WebviewWindow, anchor: Option<IconAnchor>) {
    crate::recover_pending_renderer(window);
    let monitor = match &anchor {
        Some(a) => app.monitor_from_point(a.click.x, a.click.y).ok().flatten(),
        None => app
            .cursor_position()
            .ok()
            .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten()),
    }
    .or_else(|| app.primary_monitor().ok().flatten());
    let mut height = stored_height(app);
    if let Some(monitor) = &monitor {
        let area_logical = monitor.work_area().size.height as f64 / monitor.scale_factor();
        height = clamp_panel_height(height, MENUBAR_PANEL_MIN_HEIGHT, max_panel_height(area_logical));
    }
    let _ = window.set_size(tauri::LogicalSize::new(MENUBAR_PANEL_WIDTH, height));
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let (icon_pos, icon_size) = match &anchor {
            Some(a) => (a.rect.position.to_physical::<f64>(scale), a.rect.size.to_physical::<f64>(scale)),
            None => (tauri::PhysicalPosition::new(0.0, 0.0), tauri::PhysicalSize::new(0.0, 0.0)),
        };
        let placement = if anchor.is_none() {
            PanelPlacement::TopRightCorner
        } else if cfg!(target_os = "windows") {
            let full_pos = monitor.position();
            let full_size = monitor.size();
            let edge = detect_taskbar_edge(
                (full_pos.x as f64, full_pos.y as f64, full_size.width as f64, full_size.height as f64),
                (
                    area.position.x as f64,
                    area.position.y as f64,
                    area.size.width as f64,
                    area.size.height as f64,
                ),
                (icon_pos.x + icon_size.width / 2.0, icon_pos.y + icon_size.height / 2.0),
            );
            placement_for_taskbar(edge)
        } else {
            PanelPlacement::Below
        };
        let (x, y) = compute_panel_position(PanelGeometry {
            placement,
            icon_x: icon_pos.x,
            icon_y: icon_pos.y,
            icon_width: icon_size.width,
            icon_height: icon_size.height,
            window_width: MENUBAR_PANEL_WIDTH * scale,
            window_height: height * scale,
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

/// Linux tray menu item: shows the panel near the top-right of the work area (no toggle; the menu
/// click itself is not a tray-icon click, so there is no blur race to guard against).
#[cfg(any(target_os = "linux", test))]
pub(crate) fn open_panel_in_corner(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MENUBAR_PANEL_WINDOW_LABEL) else {
        log::warn!("menubar panel: window missing, showing main window");
        crate::show_main(app);
        return;
    };
    show_panel(app, &window, None);
}

/// Left-click on the tray icon (macOS, Windows): toggle the panel next to the icon. Falls back to the main window
/// when the panel window is unavailable.
#[cfg(any(target_os = "macos", target_os = "windows", test))]
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
    show_panel(app, &window, Some(IconAnchor { rect: *rect, click }));
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuBarOpenPayload {
    task_id: Option<String>,
    ask: Option<String>,
    open_capture: bool,
}

/// Panel replacement for the tray menu's "Lock" item (macOS has no tray menu; also handy elsewhere).
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

/// Resizes the panel to `height` logical px (None resets to the default), keeping the top edge
/// anchored under the menu bar icon. `finish` ends a drag: the height is saved and blur-hide re-arms.
/// Returns the height that was applied after clamping to [420, screen height - menu bar - margin].
#[tauri::command(async)]
pub(crate) fn menubar_panel_resize(
    app: tauri::AppHandle,
    height: Option<f64>,
    finish: bool,
) -> Result<f64, String> {
    let window = app
        .get_webview_window(MENUBAR_PANEL_WINDOW_LABEL)
        .ok_or_else(|| "menu bar panel window is missing".to_string())?;
    if !finish {
        RESIZING.store(true, Ordering::SeqCst);
    }
    let area_logical = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.work_area().size.height as f64 / m.scale_factor())
        .unwrap_or(MENUBAR_PANEL_HEIGHT + ICON_GAP + SCREEN_BOTTOM_MARGIN + 200.0);
    let requested = height.unwrap_or(MENUBAR_PANEL_HEIGHT);
    let applied = clamp_panel_height(requested, MENUBAR_PANEL_MIN_HEIGHT, max_panel_height(area_logical));
    // Native resizing may move the origin (Cocoa grows windows upward); pin the top-left back.
    let anchor = window.outer_position().ok();
    window
        .set_size(tauri::LogicalSize::new(MENUBAR_PANEL_WIDTH, applied))
        .map_err(|e| e.to_string())?;
    if let Some(position) = anchor {
        let _ = window.set_position(position);
    }
    PANEL_HEIGHT_BITS.store(applied.to_bits(), Ordering::SeqCst);
    if finish {
        persist_height(&app, applied);
        LAST_RESIZE_END_MS.store(now_ms(), Ordering::SeqCst);
        RESIZING.store(false, Ordering::SeqCst);
    }
    Ok(applied)
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
            placement: PanelPlacement::Below,
            icon_x: 1000.0,
            icon_y: 10.0,
            icon_width: 40.0,
            icon_height: 40.0,
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
        let g = PanelGeometry { icon_y: -40.0, gap: 0.0, ..geometry() };
        assert_eq!(compute_panel_position(g).1, 50);
    }

    #[test]
    fn height_is_clamped_between_min_and_max() {
        assert_eq!(clamp_panel_height(100.0, 420.0, 800.0), 420.0);
        assert_eq!(clamp_panel_height(5000.0, 420.0, 800.0), 800.0);
        assert_eq!(clamp_panel_height(600.0, 420.0, 800.0), 600.0);
        assert_eq!(clamp_panel_height(f64::NAN, 420.0, 800.0), 600.0);
        // A tiny screen never produces max < min.
        assert_eq!(clamp_panel_height(700.0, 420.0, 300.0), 420.0);
    }

    #[test]
    fn max_height_leaves_a_bottom_margin() {
        assert_eq!(max_panel_height(900.0), 900.0 - ICON_GAP - SCREEN_BOTTOM_MARGIN);
        assert_eq!(max_panel_height(300.0), MENUBAR_PANEL_MIN_HEIGHT);
    }

    #[test]
    fn saved_height_round_trips_and_rejects_junk() {
        assert_eq!(parse_saved_height(&serialize_height(512.0)), Some(512.0));
        assert_eq!(parse_saved_height("not json"), None);
        assert_eq!(parse_saved_height("{\"height\":\"tall\"}"), None);
        assert_eq!(parse_saved_height("{}"), None);
    }

    #[test]
    fn clamps_to_the_bottom_edge_on_short_screens() {
        let g = PanelGeometry { area_height: 900.0, ..geometry() };
        assert_eq!(compute_panel_position(g).1, 50);
    }

    /// Windows, 1920x1080 at 100%, taskbar 48px at the bottom, icon in the tray at the right.
    fn windows_bottom() -> PanelGeometry {
        PanelGeometry {
            placement: PanelPlacement::Above,
            icon_x: 1700.0,
            icon_y: 1040.0,
            icon_width: 24.0,
            icon_height: 40.0,
            window_width: 380.0,
            window_height: 600.0,
            area_x: 0.0,
            area_y: 0.0,
            area_width: 1920.0,
            area_height: 1032.0,
            margin: 8.0,
            gap: 4.0,
        }
    }

    #[test]
    fn opens_above_a_bottom_taskbar_icon() {
        // x: 1712 - 190 = 1522; y: 1040 - 4 - 600 = 436, clamped to the work-area bottom margin
        // (1032 - 600 - 8 = 424)
        assert_eq!(compute_panel_position(windows_bottom()), (1522, 424));
    }

    #[test]
    fn above_placement_clamps_to_the_right_edge_and_top() {
        let g = PanelGeometry { icon_x: 1910.0, ..windows_bottom() };
        assert_eq!(compute_panel_position(g).0, 1920 - 380 - 8);
        let tall = PanelGeometry { window_height: 1200.0, ..windows_bottom() };
        assert_eq!(compute_panel_position(tall).1, 0);
    }

    #[test]
    fn opens_beside_side_taskbars() {
        let left = PanelGeometry {
            placement: PanelPlacement::RightOf,
            icon_x: 0.0,
            icon_y: 500.0,
            icon_width: 48.0,
            icon_height: 40.0,
            area_x: 48.0,
            area_width: 1872.0,
            area_height: 1080.0,
            ..windows_bottom()
        };
        // x: 48 + 4 = 52 (clamped to area_x + margin = 56); y: 520 - 300 = 220
        assert_eq!(compute_panel_position(left), (56, 220));
        let right = PanelGeometry {
            placement: PanelPlacement::LeftOf,
            icon_x: 1872.0,
            icon_y: 500.0,
            icon_width: 48.0,
            icon_height: 40.0,
            area_width: 1872.0,
            area_height: 1080.0,
            ..windows_bottom()
        };
        // x: 1872 - 4 - 380 = 1488, clamped to 1872 - 380 - 8 = 1484; y: 220
        assert_eq!(compute_panel_position(right), (1484, 220));
    }

    #[test]
    fn top_taskbar_opens_below() {
        let g = PanelGeometry {
            placement: PanelPlacement::Below,
            icon_y: 4.0,
            area_y: 48.0,
            area_height: 1032.0,
            ..windows_bottom()
        };
        assert_eq!(compute_panel_position(g).1, 48);
        assert_eq!(placement_for_taskbar(TaskbarEdge::Top), PanelPlacement::Below);
    }

    #[test]
    fn linux_corner_is_top_right_of_the_work_area() {
        let g = PanelGeometry {
            placement: PanelPlacement::TopRightCorner,
            icon_x: 0.0,
            icon_y: 0.0,
            icon_width: 0.0,
            icon_height: 0.0,
            area_x: 100.0,
            area_y: 30.0,
            area_width: 1820.0,
            area_height: 1050.0,
            ..windows_bottom()
        };
        assert_eq!(compute_panel_position(g), (100 + 1820 - 380 - 8, 30 + 8));
    }

    #[test]
    fn taskbar_edge_is_found_from_the_work_area_inset() {
        let mon = (0.0, 0.0, 1920.0, 1080.0);
        let icon = (1700.0, 1060.0);
        assert_eq!(detect_taskbar_edge(mon, (0.0, 0.0, 1920.0, 1032.0), icon), TaskbarEdge::Bottom);
        assert_eq!(detect_taskbar_edge(mon, (0.0, 48.0, 1920.0, 1032.0), icon), TaskbarEdge::Top);
        assert_eq!(detect_taskbar_edge(mon, (48.0, 0.0, 1872.0, 1080.0), icon), TaskbarEdge::Left);
        assert_eq!(detect_taskbar_edge(mon, (0.0, 0.0, 1872.0, 1080.0), icon), TaskbarEdge::Right);
        // Secondary monitor with a non-zero origin.
        let second = (1920.0, 0.0, 1920.0, 1080.0);
        assert_eq!(
            detect_taskbar_edge(second, (1920.0, 0.0, 1920.0, 1032.0), (3000.0, 1060.0)),
            TaskbarEdge::Bottom
        );
    }

    #[test]
    fn auto_hidden_taskbar_falls_back_to_the_icon_position() {
        let mon = (0.0, 0.0, 1920.0, 1080.0);
        assert_eq!(detect_taskbar_edge(mon, mon, (1700.0, 1060.0)), TaskbarEdge::Bottom);
        assert_eq!(detect_taskbar_edge(mon, mon, (1700.0, 10.0)), TaskbarEdge::Top);
        assert_eq!(detect_taskbar_edge(mon, mon, (10.0, 500.0)), TaskbarEdge::Left);
        assert_eq!(detect_taskbar_edge(mon, mon, (1910.0, 500.0)), TaskbarEdge::Right);
    }
}
