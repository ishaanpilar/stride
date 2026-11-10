#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#import <stdbool.h>
#import <string.h>

typedef void (*StrideRendererEvent)(int windowKind, int event);

enum {
    StrideRendererInstalled = 0,
    StrideRendererAutoReloadStarted = 1,
    StrideRendererReloadFinished = 2,
    StrideRendererReloadUnavailable = 3,
    StrideRendererManualReloadRequired = 4,
    StrideRendererManualReloadStarted = 5,
    StrideRendererFallbackDismissed = 6,
    StrideRendererReloadFailed = 7,
    StrideRendererFallbackUnavailable = 8,
};

/// Window kinds from here up (menu bar panel, floating timer) are small windows that are usually
/// hidden: they recover silently and never raise the "display stopped" alert.
enum { StrideFirstQuietWindowKind = 2 };

static char crashCountKey;
static char pendingRecoveryKey;
static char reloadNavigationKey;
static char alertOpenKey;
static char windowKindKey;
static char lastURLKey;
static char lastRecoveryKey;
static StrideRendererEvent logEvent;
static void (*originalTermination)(id, SEL, WKWebView *);
static void (*originalFinish)(id, SEL, WKWebView *, WKNavigation *);
static void (*originalFailure)(id, SEL, WKWebView *, WKNavigation *, NSError *);
static void (*originalProvisionalFailure)(id, SEL, WKWebView *, WKNavigation *, NSError *);

static void emit(WKWebView *webView, int event) {
    if (logEvent != NULL) {
        NSNumber *kind = objc_getAssociatedObject(webView, &windowKindKey);
        logEvent(kind.intValue, event);
    }
}


/// Remembers the page address while the renderer is alive: after the WebContent process is killed
/// (for example by macOS under memory pressure) `webView.URL` can be nil and `reload` returns nil.
static void rememberURL(WKWebView *webView) {
    NSURL *url = webView.URL;
    if (url != nil) {
        objc_setAssociatedObject(webView, &lastURLKey, url, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
}

/// Reloads the page, falling back to loading the last known address when `reload` has nothing to reload.
static WKNavigation *startRecoveryLoad(WKWebView *webView) {
    WKNavigation *navigation = [webView reload];
    if (navigation == nil) {
        NSURL *url = webView.URL ?: objc_getAssociatedObject(webView, &lastURLKey);
        if (url != nil) {
            navigation = [webView loadRequest:[NSURLRequest requestWithURL:url]];
        }
    }
    objc_setAssociatedObject(webView, &reloadNavigationKey, navigation, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return navigation;
}

static bool isQuietWindow(WKWebView *webView) {
    NSNumber *kind = objc_getAssociatedObject(webView, &windowKindKey);
    return kind.intValue >= StrideFirstQuietWindowKind;
}

static void showFallback(WKWebView *webView);

static void showFallback(WKWebView *webView) {
    if (isQuietWindow(webView)) {
        // No alert for a window that may be hidden: try again the next time it is opened.
        objc_setAssociatedObject(webView, &pendingRecoveryKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        emit(webView, StrideRendererFallbackUnavailable);
        return;
    }
    if ([objc_getAssociatedObject(webView, &alertOpenKey) boolValue]) {
        return;
    }
    objc_setAssociatedObject(webView, &alertOpenKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    __weak WKWebView *weakWebView = webView;

    dispatch_async(dispatch_get_main_queue(), ^{
        WKWebView *view = weakWebView;
        NSWindow *window = view.window;
        if (window == nil) {
            if (view != nil) {
                objc_setAssociatedObject(view, &alertOpenKey, @NO, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                emit(view, StrideRendererFallbackUnavailable);
            }
            return;
        }

        NSAlert *alert = [NSAlert new];
        alert.messageText = @"Stride's display stopped unexpectedly";
        alert.informativeText = @"Saved data is retained. Edits not saved before the interruption may be lost. Reload this window to try again; an interrupted File Sync may need an app restart.";
        [alert addButtonWithTitle:@"Reload Window"];
        [alert addButtonWithTitle:@"Later"];
        if (!window.isVisible) {
            [window makeKeyAndOrderFront:nil];
        }
        [NSApp activateIgnoringOtherApps:YES];
        [alert beginSheetModalForWindow:window completionHandler:^(NSModalResponse response) {
            WKWebView *currentView = weakWebView;
            if (currentView == nil) {
                return;
            }
            objc_setAssociatedObject(currentView, &alertOpenKey, @NO, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            if (response != NSAlertFirstButtonReturn) {
                emit(currentView, StrideRendererFallbackDismissed);
                return;
            }
            emit(currentView, StrideRendererManualReloadStarted);
            WKNavigation *navigation = startRecoveryLoad(currentView);
            if (navigation == nil) {
                emit(currentView, StrideRendererReloadUnavailable);
                showFallback(currentView);
            }
        }];
    });
}

static void rendererTerminated(id self, SEL command, WKWebView *webView) {

    originalTermination(self, command, webView);

    objc_setAssociatedObject(webView, &reloadNavigationKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    // A crash long after the last successful recovery is a new incident, not a crash loop.
    NSDate *lastRecovery = objc_getAssociatedObject(webView, &lastRecoveryKey);
    if (lastRecovery != nil && -[lastRecovery timeIntervalSinceNow] > 120) {
        objc_setAssociatedObject(webView, &crashCountKey, @0, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    NSUInteger crashes = [objc_getAssociatedObject(webView, &crashCountKey) unsignedIntegerValue] + 1;
    objc_setAssociatedObject(webView, &crashCountKey, @(crashes), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (crashes == 1) {
        emit(webView, StrideRendererAutoReloadStarted);
        if (startRecoveryLoad(webView) != nil) {
            return;
        }
        // Under memory pressure WebKit may not be ready to start a new renderer yet: retry once shortly.
        __weak WKWebView *weakWebView = webView;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            WKWebView *view = weakWebView;
            if (view == nil) {
                return;
            }
            if (startRecoveryLoad(view) == nil) {
                emit(view, StrideRendererReloadUnavailable);
                showFallback(view);
            }
        });
        return;
    }
    emit(webView, StrideRendererManualReloadRequired);
    showFallback(webView);
}

static void rendererDidFinish(id self, SEL command, WKWebView *webView, WKNavigation *navigation) {
    if (originalFinish != NULL) {
        originalFinish(self, command, webView, navigation);
    }
    rememberURL(webView);
    if (navigation != nil && navigation == objc_getAssociatedObject(webView, &reloadNavigationKey)) {
        objc_setAssociatedObject(webView, &reloadNavigationKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        objc_setAssociatedObject(webView, &pendingRecoveryKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        objc_setAssociatedObject(webView, &lastRecoveryKey, [NSDate date], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        emit(webView, StrideRendererReloadFinished);
    }
}

static void rendererDidFail(id self, SEL command, WKWebView *webView,
                            WKNavigation *navigation, NSError *error) {
    if (command == @selector(webView:didFailProvisionalNavigation:withError:)) {
        if (originalProvisionalFailure != NULL) {
            originalProvisionalFailure(self, command, webView, navigation, error);
        }
    } else if (originalFailure != NULL) {
        originalFailure(self, command, webView, navigation, error);
    }
    if (navigation != nil && navigation == objc_getAssociatedObject(webView, &reloadNavigationKey)) {
        objc_setAssociatedObject(webView, &reloadNavigationKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

        emit(webView, StrideRendererReloadFailed);
        showFallback(webView);
    }
}

/// Called just before a quiet window is shown: reloads it if its earlier recovery did not succeed.
void stride_macos_recover_pending_renderer(void *rawWebView) {
    if (rawWebView == NULL || ![NSThread isMainThread]) {
        return;
    }
    WKWebView *webView = (__bridge WKWebView *)rawWebView;
    if (![objc_getAssociatedObject(webView, &pendingRecoveryKey) boolValue]) {
        return;
    }
    objc_setAssociatedObject(webView, &pendingRecoveryKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(webView, &crashCountKey, @0, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    emit(webView, StrideRendererManualReloadStarted);
    if (startRecoveryLoad(webView) == nil) {
        objc_setAssociatedObject(webView, &pendingRecoveryKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        emit(webView, StrideRendererReloadUnavailable);
    }
}

bool stride_macos_install_renderer_recovery(void *rawWebView, int kind,
                                              StrideRendererEvent callback) {
    if (rawWebView == NULL || callback == NULL || ![NSThread isMainThread]) {
        return false;
    }
    WKWebView *webView = (__bridge WKWebView *)rawWebView;
    id delegate = webView.navigationDelegate;
    Class base = object_getClass(delegate);
    if (base == Nil || strcmp(class_getName(base), "WryNavigationDelegate") != 0) {
        return false;
    }

    SEL terminated = @selector(webViewWebContentProcessDidTerminate:);
    Method termination = class_getInstanceMethod(base, terminated);
    Method finish = class_getInstanceMethod(base, @selector(webView:didFinishNavigation:));
    if (termination == NULL || finish == NULL) {
        return false;
    }
    Class subclass = objc_getClass("StrideRecoverableNavigationDelegate");
    if (subclass == Nil) {
        subclass = objc_allocateClassPair(base, "StrideRecoverableNavigationDelegate", 0);
        if (subclass == Nil ||
            !class_addMethod(subclass, terminated, (IMP)rendererTerminated,
                             method_getTypeEncoding(termination)) ||
            !class_addMethod(subclass, @selector(webView:didFinishNavigation:),
                             (IMP)rendererDidFinish, method_getTypeEncoding(finish)) ||
            !class_addMethod(subclass, @selector(webView:didFailNavigation:withError:),
                             (IMP)rendererDidFail, "v@:@@@") ||
            !class_addMethod(subclass, @selector(webView:didFailProvisionalNavigation:withError:),
                             (IMP)rendererDidFail, "v@:@@@")) {
            if (subclass != Nil) {
                objc_disposeClassPair(subclass);
            }
            return false;
        }
        objc_registerClassPair(subclass);
        originalTermination = (void (*)(id, SEL, WKWebView *))method_getImplementation(termination);
        originalFinish = (void (*)(id, SEL, WKWebView *, WKNavigation *))method_getImplementation(finish);
        Method failure = class_getInstanceMethod(base, @selector(webView:didFailNavigation:withError:));
        Method provisionalFailure = class_getInstanceMethod(base, @selector(webView:didFailProvisionalNavigation:withError:));
        originalFailure = failure == NULL ? NULL : (void (*)(id, SEL, WKWebView *, WKNavigation *, NSError *))method_getImplementation(failure);
        originalProvisionalFailure = provisionalFailure == NULL ? NULL : (void (*)(id, SEL, WKWebView *, WKNavigation *, NSError *))method_getImplementation(provisionalFailure);
    } else if (class_getSuperclass(subclass) != base || originalTermination == NULL) {
        return false;
    }

    logEvent = callback;
    objc_setAssociatedObject(webView, &windowKindKey, @(kind), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    rememberURL(webView);
    object_setClass(delegate, subclass);
    emit(webView, StrideRendererInstalled);
    return true;
}
