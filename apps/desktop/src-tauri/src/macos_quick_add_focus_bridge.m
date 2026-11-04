#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <stdbool.h>


@interface StrideQuickAddPanel : NSPanel
@end

@implementation StrideQuickAddPanel


- (BOOL)canBecomeKeyWindow {
    return YES;
}
@end


static void stride_quick_add_run_on_main(dispatch_block_t block) {
    if ([NSThread isMainThread]) {
        block();
        return;
    }
    dispatch_async(dispatch_get_main_queue(), block);
}


bool stride_macos_make_quick_add_panel(void *ns_window) {
    if (ns_window == NULL) {
        return false;
    }

    NSWindow *window = (__bridge NSWindow *)ns_window;
    Class panelClass = [StrideQuickAddPanel class];


    if (class_getInstanceSize(panelClass) > class_getInstanceSize(object_getClass(window))) {
        return false;
    }

    stride_quick_add_run_on_main(^{
        object_setClass(window, panelClass);
        [window setStyleMask:[window styleMask] | NSWindowStyleMaskNonactivatingPanel];


        [window setHidesOnDeactivate:NO];


        [window setCollectionBehavior:[window collectionBehavior] |
                                      NSWindowCollectionBehaviorCanJoinAllSpaces |
                                      NSWindowCollectionBehaviorFullScreenAuxiliary];
    });

    return true;
}


bool stride_macos_present_quick_add_panel(void *ns_window) {
    if (ns_window == NULL) {
        return false;
    }

    NSWindow *window = (__bridge NSWindow *)ns_window;
    if (![window isKindOfClass:[StrideQuickAddPanel class]]) {
        return false;
    }

    stride_quick_add_run_on_main(^{
        [window orderFrontRegardless];
        [window makeKeyWindow];
    });

    return true;
}
