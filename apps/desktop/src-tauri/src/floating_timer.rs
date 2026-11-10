//! Floating focus timer: a small always-on-top window that keeps the Pomodoro visible over any
//! app, on every Space and over full-screen apps, while the main window is hidden or behind.
//!
//! The window is another webview (`index.html?focusFloat=1`) created lazily the first time it is
//! shown, so users who never float the timer pay nothing. It is a pure view: the main window owns
//! the timer (ticks, alerts, credits) and pushes state to it with events; the float sends actions
//! back. Rust here only owns window lifecycle, macOS panel behaviour, and the position, which is
//! remembered per screen and always clamped into the visible work area (after a drag, on show,
//! and when the window lands on another display).
//!
//! It lives inside the app process: when the app quits, the float goes with it.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

pub(crate) const FOCUS_FLOAT_WINDOW_LABEL: &str = "focus-float";
const FOCUS_FLOAT_WINDOW_URL: &str = "index.html?focusFloat=1";
/// Logical size of the compact and expanded float.
const FLOAT_WIDTH: f64 = 300.0;
const FLOAT_COMPACT_HEIGHT: f64 = 88.0;
const FLOAT_EXPANDED_HEIGHT: f64 = 200.0;
/// Logical gap kept between the float and the edges of the visible screen area.
const FLOAT_MARGIN: f64 = 12.0;
/// Default spot on a screen the float has never been on: top-right, below the menu bar.
const DEFAULT_INSET: f64 = 24.0;
const FLOAT_STATE_FILE: &str = "focus-float.json";
/// Emitted to the float each time it is shown (it asks the main window for fresh state).
const FOCUS_FLOAT_SHOWN_EVENT: &str = "focus-float-shown";
/// Emitted to the main window when the float asks to open Stride (full Focus stage).
const FOCUS_FLOAT_OPEN_EVENT: &str = "focus-float-open";
/// A drag sends a burst of Moved events; settle (clamp + save) once they stop.
const SETTLE_DELAY_MS: u64 = 220;
#[cfg(target_os = "macos")]
const FLOAT_CORNER_RADIUS: f64 = 16.0;

static EXPANDED: AtomicBool = AtomicBool::new(false);
static MOVE_GENERATION: AtomicU64 = AtomicU64::new(0);
static PLACEMENT: Mutex<Option<FloatPlacement>> = Mutex::new(None);

/// A screen's visible area (menu bar and Dock excluded), in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Offset of the float's top-left corner from a screen's visible area, in logical points.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Offset {
    pub x: f64,
    pub y: f64,
}

/// What is remembered between launches: where the float sat on each screen, and the last screen.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FloatPlacement {
    #[serde(default)]
    pub last_screen: Option<String>,
    #[serde(default)]
    pub screens: BTreeMap<String, Offset>,
}

/// Moves a `width` x `height` rect at (x, y) fully inside `area`, `margin` from every edge.
/// Too-small areas pin the rect to the top-left margin; non-finite input falls back to that too.
pub(crate) fn clamp_into_area(x: f64, y: f64, width: f64, height: f64, area: Area, margin: f64) -> (f64, f64) {
    let min_x = area.x + margin;
    let min_y = area.y + margin;
    let max_x = (area.x + area.width - width - margin).max(min_x);
    let max_y = (area.y + area.height - height - margin).max(min_y);
    let x = if x.is_finite() { x } else { min_x };
    let y = if y.is_finite() { y } else { min_y };
    (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

/// The screen a rect belongs to: the one it overlaps most, else the nearest one (by centre).
pub(crate) fn pick_area(x: f64, y: f64, width: f64, height: f64, areas: &[Area]) -> Option<usize> {
    let overlap = |a: &Area| {
        let w = (x + width).min(a.x + a.width) - x.max(a.x);
        let h = (y + height).min(a.y + a.height) - y.max(a.y);
        if w > 0.0 && h > 0.0 { w * h } else { 0.0 }
    };
    let best = areas
        .iter()
        .enumerate()
        .map(|(index, area)| (index, overlap(area)))
        .filter(|(_, amount)| *amount > 0.0)
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(index, _)| index);
    if best.is_some() {
        return best;
    }
    let (cx, cy) = (x + width / 2.0, y + height / 2.0);
    areas
        .iter()
        .enumerate()
        .map(|(index, a)| {
            let dx = cx - (a.x + a.width / 2.0);
            let dy = cy - (a.y + a.height / 2.0);
            (index, dx * dx + dy * dy)
        })
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(index, _)| index)
}

/// Stable identity for a screen across launches (name plus native resolution).
pub(crate) fn screen_key(name: Option<&str>, width: u32, height: u32) -> String {
    format!("{}@{width}x{height}", name.filter(|n| !n.trim().is_empty()).unwrap_or("screen"))
}

/// Top-right of the visible area, inset from the edges.
pub(crate) fn default_offset(area_width_logical: f64, window_width: f64) -> Offset {
    Offset { x: (area_width_logical - window_width - DEFAULT_INSET).max(DEFAULT_INSET), y: DEFAULT_INSET }
}

/// Physical position for the float on a screen: the remembered offset (or the default), clamped.
pub(crate) fn resolve_position(
    placement: &FloatPlacement,
    key: &str,
    area: Area,
    scale: f64,
    window_width: f64,
    window_height: f64,
) -> (i32, i32) {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let offset = placement
        .screens
        .get(key)
        .copied()
        .unwrap_or_else(|| default_offset(area.width / scale, window_width));
    let (x, y) = clamp_into_area(
        area.x + offset.x * scale,
        area.y + offset.y * scale,
        window_width * scale,
        window_height * scale,
        area,
        FLOAT_MARGIN * scale,
    );
    (x.round() as i32, y.round() as i32)
}

/// Records where the float now sits (physical) as an offset on `key`'s screen.
pub(crate) fn remember_position(placement: &mut FloatPlacement, key: &str, area: Area, scale: f64, x: f64, y: f64) {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let offset = Offset { x: ((x - area.x) / scale).round(), y: ((y - area.y) / scale).round() };
    placement.screens.insert(key.to_string(), offset);
    placement.last_screen = Some(key.to_string());
}

pub(crate) fn parse_placement(raw: &str) -> FloatPlacement {
    let mut placement: FloatPlacement = serde_json::from_str(raw).unwrap_or_default();
    placement.screens.retain(|_, offset| offset.x.is_finite() && offset.y.is_finite());
    placement
}

pub(crate) fn serialize_placement(placement: &FloatPlacement) -> String {
    serde_json::to_string(placement).unwrap_or_else(|_| "{}".to_string())
}

pub(crate) fn float_height(expanded: bool) -> f64 {
    if expanded { FLOAT_EXPANDED_HEIGHT } else { FLOAT_COMPACT_HEIGHT }
}

fn state_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FLOAT_STATE_FILE))
}

fn with_placement<T>(app: &tauri::AppHandle, f: impl FnOnce(&mut FloatPlacement) -> T) -> T {
    let mut guard = PLACEMENT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let placement = guard.get_or_insert_with(|| {
        state_file(app)
            .and_then(|path| std::fs::read_to_string(path).ok())
            .map(|raw| parse_placement(&raw))
            .unwrap_or_default()
    });
    f(placement)
}

fn persist_placement(app: &tauri::AppHandle) {
    let raw = with_placement(app, |placement| serialize_placement(placement));
    if let Some(path) = state_file(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, raw);
    }
}

struct Screen {
    key: String,
    area: Area,
    scale: f64,
}

fn screens(app: &tauri::AppHandle) -> Vec<Screen> {
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let work = monitor.work_area();
            Screen {
                key: screen_key(monitor.name().map(String::as_str), monitor.size().width, monitor.size().height),
                area: Area {
                    x: work.position.x as f64,
                    y: work.position.y as f64,
                    width: work.size.width as f64,
                    height: work.size.height as f64,
                },
                scale: monitor.scale_factor(),
            }
        })
        .collect()
}

/// The screen to show on: the last one used if still connected, else the main window's screen,
/// else the first one.
fn screen_for_show(app: &tauri::AppHandle, list: &[Screen]) -> Option<usize> {
    let last = with_placement(app, |placement| placement.last_screen.clone());
    if let Some(index) = last.and_then(|key| list.iter().position(|screen| screen.key == key)) {
        return Some(index);
    }
    let main_rect = app.get_webview_window("main").and_then(|main| {
        let position = main.outer_position().ok()?;
        let size = main.outer_size().ok()?;
        Some((position.x as f64, position.y as f64, size.width as f64, size.height as f64))
    });
    let areas: Vec<Area> = list.iter().map(|screen| screen.area).collect();
    main_rect
        .and_then(|(x, y, w, h)| pick_area(x, y, w, h, &areas))
        .or(if list.is_empty() { None } else { Some(0) })
}

/// Clamps the float into the screen it now overlaps most and remembers the spot for that screen.
fn settle(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(FOCUS_FLOAT_WINDOW_LABEL) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let list = screens(app);
    let areas: Vec<Area> = list.iter().map(|screen| screen.area).collect();
    let (x, y, w, h) = (position.x as f64, position.y as f64, size.width as f64, size.height as f64);
    let Some(index) = pick_area(x, y, w, h, &areas) else {
        return;
    };
    let screen = &list[index];
    let (cx, cy) = clamp_into_area(x, y, w, h, screen.area, FLOAT_MARGIN * screen.scale);
    let (cx, cy) = (cx.round(), cy.round());
    if (cx - x).abs() >= 1.0 || (cy - y).abs() >= 1.0 {
        let _ = window.set_position(tauri::PhysicalPosition::new(cx as i32, cy as i32));
    }
    with_placement(app, |placement| remember_position(placement, &screen.key, screen.area, screen.scale, cx, cy));
    persist_placement(app);
}

/// Debounces Moved / ScaleFactorChanged bursts (a drag, a display change) into one settle.
fn schedule_settle(app: &tauri::AppHandle) {
    let generation = MOVE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(SETTLE_DELAY_MS));
        if MOVE_GENERATION.load(Ordering::SeqCst) == generation {
            settle(&handle);
        }
    });
}

fn ensure_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(FOCUS_FLOAT_WINDOW_LABEL) {
        return Ok(window);
    }
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        FOCUS_FLOAT_WINDOW_LABEL,
        tauri::WebviewUrl::App(FOCUS_FLOAT_WINDOW_URL.into()),
    );
    if let Some(webview_dir) = crate::storage::portable_webview_data_dir() {
        let _ = std::fs::create_dir_all(&webview_dir);
        builder = builder.data_directory(webview_dir);
    }
    // Transparent with a native vibrancy layer, like the menu bar panel; the webview paints a
    // translucent rounded surface on top. Clicks land on buttons even when another app is active.
    #[cfg(target_os = "macos")]
    {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::{Effect, EffectState};
        builder = builder
            .transparent(true)
            .effects(WindowEffectsConfig {
                effects: vec![Effect::Popover],
                state: Some(EffectState::Active),
                radius: Some(FLOAT_CORNER_RADIUS),
                color: None,
            })
            .accept_first_mouse(true);
    }
    let window = builder
        .title("Stride focus timer")
        .inner_size(FLOAT_WIDTH, float_height(EXPANDED.load(Ordering::SeqCst)))
        .resizable(false)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|error| format!("Failed to create the floating timer window: {error}"))?;
    crate::install_renderer_recovery(&window);
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::ScaleFactorChanged { .. } => schedule_settle(&handle),
        _ => {}
    });
    #[cfg(target_os = "macos")]
    {
        let target = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(ns_window) = target.ns_window() {
                unsafe { native::make_floating_panel(ns_window) };
            }
        });
    }
    log::info!("floating timer: window created");
    Ok(window)
}

fn show(app: &tauri::AppHandle) -> Result<(), String> {
    let window = ensure_window(app)?;
    crate::recover_pending_renderer(&window);
    let was_visible = window.is_visible().unwrap_or(false);
    let height = float_height(EXPANDED.load(Ordering::SeqCst));
    let _ = window.set_size(tauri::LogicalSize::new(FLOAT_WIDTH, height));
    if !was_visible {
        let list = screens(app);
        if let Some(screen) = screen_for_show(app, &list).and_then(|index| list.get(index)) {
            let (x, y) = with_placement(app, |placement| {
                resolve_position(placement, &screen.key, screen.area, screen.scale, FLOAT_WIDTH, height)
            });
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
    #[cfg(target_os = "macos")]
    {
        // Order front without making it key: the app the user is working in keeps the keyboard.
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                if let Ok(ns_window) = target.ns_window() {
                    unsafe { native::order_front(ns_window) };
                }
            })
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.show().map_err(|error| error.to_string())?;
    }
    let _ = window.emit(FOCUS_FLOAT_SHOWN_EVENT, ());
    if !was_visible {
        log::info!("floating timer: shown");
    }
    Ok(())
}

/// Hides the float. Returns true if it was visible. The timer is untouched.
pub(crate) fn hide(app: &tauri::AppHandle) -> bool {
    let Some(window) = app.get_webview_window(FOCUS_FLOAT_WINDOW_LABEL) else {
        return false;
    };
    let was_visible = window.is_visible().unwrap_or(false);
    if was_visible {
        let _ = window.hide();
        log::info!("floating timer: hidden");
    }
    was_visible
}

#[tauri::command(async)]
pub(crate) fn focus_float_show(app: tauri::AppHandle) -> Result<(), String> {
    show(&app)
}

#[tauri::command(async)]
pub(crate) fn focus_float_hide(app: tauri::AppHandle) {
    hide(&app);
}

/// Grows to show the current and next step, or shrinks back, keeping the top-left corner put
/// (then clamped, so growing near the bottom of a screen moves it up).
#[tauri::command(async)]
pub(crate) fn focus_float_set_expanded(app: tauri::AppHandle, expanded: bool) -> Result<(), String> {
    EXPANDED.store(expanded, Ordering::SeqCst);
    let Some(window) = app.get_webview_window(FOCUS_FLOAT_WINDOW_LABEL) else {
        return Ok(());
    };
    let anchor = window.outer_position().ok();
    window
        .set_size(tauri::LogicalSize::new(FLOAT_WIDTH, float_height(expanded)))
        .map_err(|error| error.to_string())?;
    if let Some(position) = anchor {
        let _ = window.set_position(position);
    }
    settle(&app);
    Ok(())
}

/// Brings the main window forward and asks it to show the full Focus stage.
#[tauri::command(async)]
pub(crate) fn focus_float_open_main(app: tauri::AppHandle) {
    crate::show_main(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit(FOCUS_FLOAT_OPEN_EVENT, ());
    }
}

#[cfg(target_os = "macos")]
mod native {
    //! AppKit calls through the Objective-C runtime (no extra crates): turn the window into a
    //! non-activating panel that floats above full-screen apps on every Space.
    use std::ffi::{c_void, CStr};
    use std::os::raw::c_char;

    /// `NSStatusWindowLevel`: above normal and floating windows (and full-screen apps), below menus.
    const NS_STATUS_WINDOW_LEVEL: isize = 25;
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const STATIONARY: usize = 1 << 4;
    const IGNORES_CYCLE: usize = 1 << 6;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        fn objc_msgSend();
    }

    extern "C" {
        // Shared with the Quick Add window (src/macos_quick_add_focus_bridge.m): swaps the window's
        // class to a non-activating NSPanel that never hides on deactivate.
        fn stride_macos_make_quick_add_panel(ns_window: *mut std::ffi::c_void) -> bool;
    }

    unsafe fn sel(name: &CStr) -> *mut c_void {
        sel_registerName(name.as_ptr())
    }

    unsafe fn send0(target: *mut c_void, name: &CStr) {
        let f: unsafe extern "C" fn(*mut c_void, *mut c_void) = std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        f(target, sel(name));
    }

    unsafe fn send_isize(target: *mut c_void, name: &CStr, value: isize) {
        let f: unsafe extern "C" fn(*mut c_void, *mut c_void, isize) =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        f(target, sel(name), value);
    }

    unsafe fn send_usize(target: *mut c_void, name: &CStr, value: usize) {
        let f: unsafe extern "C" fn(*mut c_void, *mut c_void, usize) =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        f(target, sel(name), value);
    }

    unsafe fn send_bool(target: *mut c_void, name: &CStr, value: bool) {
        let f: unsafe extern "C" fn(*mut c_void, *mut c_void, i8) =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        f(target, sel(name), i8::from(value));
    }

    unsafe fn responds_to(target: *mut c_void, name: &CStr) -> bool {
        let f: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> i8 =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        f(target, sel(c"respondsToSelector:"), sel(name)) != 0
    }

    /// Must run on the main thread.
    pub(super) unsafe fn make_floating_panel(ns_window: *mut c_void) {
        if ns_window.is_null() {
            return;
        }
        if !stride_macos_make_quick_add_panel(ns_window) {
            log::warn!("floating timer: could not become a non-activating panel; it may take focus when clicked");
        }
        send_isize(ns_window, c"setLevel:", NS_STATUS_WINDOW_LEVEL);
        send_usize(
            ns_window,
            c"setCollectionBehavior:",
            CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY,
        );
        send_bool(ns_window, c"setHidesOnDeactivate:", false);
        // Clicking a button must not pull the keyboard away from the app the user is in.
        if responds_to(ns_window, c"setBecomesKeyOnlyIfNeeded:") {
            send_bool(ns_window, c"setBecomesKeyOnlyIfNeeded:", true);
        }
    }

    /// Must run on the main thread. Shows the window without making it key or activating the app.
    pub(super) unsafe fn order_front(ns_window: *mut c_void) {
        if !ns_window.is_null() {
            send0(ns_window, c"orderFrontRegardless");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Area = Area { x: 0.0, y: 50.0, width: 2880.0, height: 1700.0 };

    #[test]
    fn clamp_keeps_a_rect_that_already_fits() {
        assert_eq!(clamp_into_area(400.0, 300.0, 600.0, 176.0, SCREEN, 24.0), (400.0, 300.0));
    }

    #[test]
    fn clamp_pulls_a_rect_back_from_every_edge() {
        assert_eq!(clamp_into_area(-500.0, 300.0, 600.0, 176.0, SCREEN, 24.0).0, 24.0);
        assert_eq!(clamp_into_area(2800.0, 300.0, 600.0, 176.0, SCREEN, 24.0).0, 2880.0 - 600.0 - 24.0);
        // Never under the menu bar (the work area starts at y = 50).
        assert_eq!(clamp_into_area(400.0, 0.0, 600.0, 176.0, SCREEN, 24.0).1, 74.0);
        assert_eq!(clamp_into_area(400.0, 5000.0, 600.0, 176.0, SCREEN, 24.0).1, 50.0 + 1700.0 - 176.0 - 24.0);
    }

    #[test]
    fn clamp_pins_to_the_top_left_on_a_too_small_area_and_on_junk() {
        let tiny = Area { x: 100.0, y: 100.0, width: 200.0, height: 50.0 };
        assert_eq!(clamp_into_area(900.0, 900.0, 600.0, 176.0, tiny, 10.0), (110.0, 110.0));
        assert_eq!(clamp_into_area(f64::NAN, f64::INFINITY, 600.0, 176.0, SCREEN, 24.0), (24.0, 74.0));
    }

    #[test]
    fn pick_area_prefers_the_largest_overlap_then_the_nearest_screen() {
        let left = Area { x: 0.0, y: 0.0, width: 1000.0, height: 800.0 };
        let right = Area { x: 1000.0, y: 0.0, width: 1000.0, height: 800.0 };
        let areas = [left, right];
        // Straddling the seam, mostly on the right.
        assert_eq!(pick_area(900.0, 100.0, 300.0, 88.0, &areas), Some(1));
        assert_eq!(pick_area(800.0, 100.0, 300.0, 88.0, &areas), Some(0));
        // Entirely off-screen (a display was unplugged): the nearest one.
        assert_eq!(pick_area(-2000.0, 100.0, 300.0, 88.0, &areas), Some(0));
        assert_eq!(pick_area(5000.0, 100.0, 300.0, 88.0, &areas), Some(1));
        assert_eq!(pick_area(0.0, 0.0, 300.0, 88.0, &[]), None);
    }

    #[test]
    fn screens_are_keyed_by_name_and_resolution() {
        assert_eq!(screen_key(Some("Built-in Retina Display"), 3024, 1964), "Built-in Retina Display@3024x1964");
        assert_eq!(screen_key(None, 1920, 1080), "screen@1920x1080");
        assert_eq!(screen_key(Some("  "), 1920, 1080), "screen@1920x1080");
    }

    #[test]
    fn a_new_screen_gets_the_top_right_corner() {
        let placement = FloatPlacement::default();
        // 2x screen: 1440 x 850 logical work area starting at y = 50 physical.
        let (x, y) = resolve_position(&placement, "a", SCREEN, 2.0, FLOAT_WIDTH, FLOAT_COMPACT_HEIGHT);
        assert_eq!(x, ((1440.0 - FLOAT_WIDTH - DEFAULT_INSET) * 2.0) as i32);
        assert_eq!(y, (50.0 + DEFAULT_INSET * 2.0) as i32);
    }

    #[test]
    fn positions_are_remembered_per_screen_and_restored_clamped() {
        let mut placement = FloatPlacement::default();
        remember_position(&mut placement, "laptop", SCREEN, 2.0, 200.0, 450.0);
        let external = Area { x: 2880.0, y: 0.0, width: 1920.0, height: 1080.0 };
        remember_position(&mut placement, "external", external, 1.0, 3000.0, 500.0);
        assert_eq!(placement.screens["laptop"], Offset { x: 100.0, y: 200.0 });
        assert_eq!(placement.screens["external"], Offset { x: 120.0, y: 500.0 });
        assert_eq!(placement.last_screen.as_deref(), Some("external"));

        assert_eq!(resolve_position(&placement, "laptop", SCREEN, 2.0, FLOAT_WIDTH, FLOAT_COMPACT_HEIGHT), (200, 450));
        // The external screen got smaller since: the saved spot is pulled back inside it.
        let smaller = Area { x: 2880.0, y: 0.0, width: 1280.0, height: 400.0 };
        let (_, y) = resolve_position(&placement, "external", smaller, 1.0, FLOAT_WIDTH, FLOAT_EXPANDED_HEIGHT);
        assert_eq!(y, (400.0 - FLOAT_EXPANDED_HEIGHT - FLOAT_MARGIN) as i32);
    }

    #[test]
    fn placement_round_trips_and_rejects_junk() {
        let mut placement = FloatPlacement::default();
        remember_position(&mut placement, "laptop", SCREEN, 2.0, 200.0, 450.0);
        assert_eq!(parse_placement(&serialize_placement(&placement)), placement);
        assert_eq!(parse_placement("not json"), FloatPlacement::default());
        assert_eq!(parse_placement("{\"screens\":{\"a\":{\"x\":\"left\",\"y\":1}}}"), FloatPlacement::default());
        let partial = parse_placement("{\"lastScreen\":\"a\"}");
        assert_eq!(partial.last_screen.as_deref(), Some("a"));
        assert!(partial.screens.is_empty());
    }

    #[test]
    fn expanded_is_taller_than_compact() {
        assert_eq!(float_height(false), 88.0);
        assert_eq!(float_height(true), 200.0);
    }
}
