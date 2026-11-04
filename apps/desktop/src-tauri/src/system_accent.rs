//! macOS system accent colour (`NSColor.controlAccentColor`) for the web UI.
//!
//! `get_system_accent_color` returns the accent as sRGB `#RRGGBB`, or `None` off macOS or on failure.
//! On macOS the `system-accent-changed` event is emitted when the user changes the accent colour.

pub(crate) const SYSTEM_ACCENT_CHANGED_EVENT: &str = "system-accent-changed";

#[cfg(target_os = "macos")]
mod native {
    use std::ffi::{c_char, CStr};
    use std::sync::OnceLock;
    use tauri::Emitter;

    extern "C" {
        fn stride_macos_system_accent_hex() -> *mut c_char;
        fn stride_macos_system_accent_free_string(ptr: *mut c_char);
        fn stride_macos_install_system_accent_listener(callback: extern "C" fn()) -> bool;
    }

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    pub(super) fn read_hex() -> Option<String> {
        let raw = unsafe { stride_macos_system_accent_hex() };
        if raw.is_null() {
            return None;
        }
        let value = unsafe { CStr::from_ptr(raw) }.to_str().ok().map(str::to_owned);
        unsafe { stride_macos_system_accent_free_string(raw) };
        value.filter(|hex| super::is_hex_color(hex))
    }

    extern "C" fn on_accent_changed() {
        if let Some(app) = APP.get() {
            let _ = app.emit(super::SYSTEM_ACCENT_CHANGED_EVENT, read_hex());
        }
    }

    pub(super) fn install(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
        unsafe { stride_macos_install_system_accent_listener(on_accent_changed) };
    }
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Starts observing accent-colour changes (no-op off macOS).
pub(crate) fn install_system_accent_listener(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    native::install(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[tauri::command(async)]
pub(crate) fn get_system_accent_color() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        native::read_hex()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::is_hex_color;

    #[test]
    fn accepts_only_seven_character_hex_colors() {
        assert!(is_hex_color("#007AFF"));
        assert!(!is_hex_color("007AFF"));
        assert!(!is_hex_color("#07AFF"));
        assert!(!is_hex_color("#GGGGGG"));
    }
}
