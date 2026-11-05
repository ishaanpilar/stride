//! System accent colour for the web UI.
//!
//! `get_system_accent_color` returns the accent as sRGB `#RRGGBB`, or `None` when the platform has
//! no accent (the frontend then uses its default accent). The `system-accent-changed` event is
//! emitted when the user changes it.
//!
//! - macOS: `NSColor.controlAccentColor`, with a native change listener.
//! - Windows: the DWM `AccentColor` registry value (ABGR DWORD), polled every few seconds.
//! - Linux: the XDG desktop portal `org.freedesktop.appearance` `accent-color` setting, polled.

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

/// Converts the DWM `AccentColor` value (0xAABBGGRR) to `#RRGGBB`; alpha is ignored.
#[cfg(any(target_os = "windows", test))]
fn abgr_to_hex(abgr: u32) -> String {
    let r = abgr & 0xff;
    let g = (abgr >> 8) & 0xff;
    let b = (abgr >> 16) & 0xff;
    format!("#{r:02X}{g:02X}{b:02X}")
}

/// Converts portal channels in [0, 1] to `#RRGGBB`. The portal reports out-of-range values when
/// the user has no accent preference, which maps to `None`.
#[cfg(any(target_os = "linux", test))]
fn unit_rgb_to_hex(r: f64, g: f64, b: f64) -> Option<String> {
    let channel = |v: f64| (v.is_finite() && (0.0..=1.0).contains(&v)).then(|| (v * 255.0).round() as u8);
    Some(format!("#{:02X}{:02X}{:02X}", channel(r)?, channel(g)?, channel(b)?))
}

#[cfg(target_os = "windows")]
mod native {
    use std::time::Duration;
    use tauri::Emitter;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    const POLL_INTERVAL: Duration = Duration::from_secs(3);

    pub(super) fn read_hex() -> Option<String> {
        let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\DWM\0".encode_utf16().collect();
        let value: Vec<u16> = "AccentColor\0".encode_utf16().collect();
        let mut data: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        // SAFETY: both names are NUL-terminated UTF-16; `data` and `size` outlive the call and
        // `size` matches the DWORD buffer.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                (&mut data as *mut u32).cast(),
                &mut size,
            )
        };
        (status == 0).then(|| super::abgr_to_hex(data))
    }

    pub(super) fn install(app: &tauri::AppHandle) {
        let app = app.clone();
        let spawned = std::thread::Builder::new().name("stride-accent-poll".into()).spawn(move || {
            let mut last = read_hex();
            loop {
                std::thread::sleep(POLL_INTERVAL);
                let current = read_hex();
                if current != last {
                    let _ = app.emit(super::SYSTEM_ACCENT_CHANGED_EVENT, current.clone());
                    last = current;
                }
            }
        });
        if let Err(error) = spawned {
            log::warn!("system accent: failed to start poller: {error}");
        }
    }
}

#[cfg(target_os = "linux")]
mod native {
    use std::time::Duration;
    use tauri::Emitter;

    const POLL_INTERVAL: Duration = Duration::from_secs(5);
    const PORTAL_TIMEOUT: Duration = Duration::from_secs(3);

    /// Reads the portal accent. `None` when there is no portal, no `accent-color` key (older
    /// desktops) or the user has not chosen one.
    pub(super) async fn read_hex() -> Option<String> {
        tokio::time::timeout(PORTAL_TIMEOUT, async {
            let settings = ashpd::desktop::settings::Settings::new().await.ok()?;
            let color = settings.accent_color().await.ok()?;
            super::unit_rgb_to_hex(color.red(), color.green(), color.blue())
        })
        .await
        .ok()
        .flatten()
    }

    pub(super) fn install(app: &tauri::AppHandle) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut last = read_hex().await;
            loop {
                tokio::time::sleep(POLL_INTERVAL).await;
                let current = read_hex().await;
                if current != last {
                    let _ = app.emit(super::SYSTEM_ACCENT_CHANGED_EVENT, current.clone());
                    last = current;
                }
            }
        });
    }
}

/// Starts observing accent-colour changes.
pub(crate) fn install_system_accent_listener(app: &tauri::AppHandle) {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    native::install(app);
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let _ = app;
}

#[tauri::command]
pub(crate) async fn get_system_accent_color() -> Option<String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        native::read_hex()
    }
    #[cfg(target_os = "linux")]
    {
        native::read_hex().await
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{abgr_to_hex, is_hex_color, unit_rgb_to_hex};

    #[test]
    fn converts_dwm_abgr_to_hex() {
        assert_eq!(abgr_to_hex(0xFFD77800), "#0078D7");
        assert_eq!(abgr_to_hex(0x00000000), "#000000");
        assert!(is_hex_color(&abgr_to_hex(0xFF123456)));
    }

    #[test]
    fn converts_portal_colors_and_rejects_unset() {
        assert_eq!(unit_rgb_to_hex(0.0, 0.5, 1.0), Some("#0080FF".to_string()));
        assert_eq!(unit_rgb_to_hex(-1.0, -1.0, -1.0), None);
        assert_eq!(unit_rgb_to_hex(f64::NAN, 0.0, 0.0), None);
    }

    #[test]
    fn accepts_only_seven_character_hex_colors() {
        assert!(is_hex_color("#007AFF"));
        assert!(!is_hex_color("007AFF"));
        assert!(!is_hex_color("#07AFF"));
        assert!(!is_hex_color("#GGGGGG"));
    }
}
