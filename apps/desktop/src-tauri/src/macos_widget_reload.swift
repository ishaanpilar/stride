import WidgetKit


@_cdecl("stride_reload_widgets")
public func stride_reload_widgets() {
    if #available(macOS 11.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
