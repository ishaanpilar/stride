# Desktop icons

Committed artifacts — nothing in the repo regenerates them.

**`icon.ico` must list 32x32 first.** Windows loads a window icon by taking the
first image in the group when it is not asked for a specific size, so an .ico
that starts with 16x16 (what `tauri icon` writes) shows an upscaled, blurry icon
in the taskbar for running windows. Pinned shortcuts do a best-fit lookup and
look fine, which is why the bug hides when you pin the app (#937).

The artwork has no vector master here. Re-exporting from a white-background
cutout brings back the white rim on dark themes that #937 fixed: export with a
real alpha matte, and check the outer ~2px of every PNG afterwards, not just the
files a report names — `apps/desktop/public/logo.png` is a separate asset from
`icon.png` and was missed once already.
