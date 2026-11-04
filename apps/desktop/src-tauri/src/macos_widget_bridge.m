#import <Foundation/Foundation.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

static NSNotificationName const StrideMacOSWidgetCaptureNotification =
    @"com.ishaanpilar.stride.widget.quick-capture";
static id strideMacOSWidgetCaptureObserver = nil;

typedef void (*StrideMacOSWidgetCaptureCallback)(void);


bool stride_macos_install_widget_capture_listener(
    const char *app_group_cstr,
    StrideMacOSWidgetCaptureCallback callback
) {
    if (!app_group_cstr || !callback) return false;

    NSString *groupId = [NSString stringWithUTF8String:app_group_cstr];
    if (!groupId) return false;

    NSDistributedNotificationCenter *center = [NSDistributedNotificationCenter defaultCenter];
    @synchronized(center) {
        if (strideMacOSWidgetCaptureObserver) return true;

        strideMacOSWidgetCaptureObserver = [center
            addObserverForName:StrideMacOSWidgetCaptureNotification
            object:groupId
            queue:[NSOperationQueue mainQueue]
            usingBlock:^(__unused NSNotification *notification) {
                callback();
            }];
    }

    return strideMacOSWidgetCaptureObserver != nil;
}


char *stride_macos_widget_container_path(const char *app_group_cstr) {
    if (!app_group_cstr) return NULL;

    NSString *groupId = [NSString stringWithUTF8String:app_group_cstr];
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSURL *containerURL = [fileManager containerURLForSecurityApplicationGroupIdentifier:groupId];
    if (!containerURL) return NULL;

    const char *path = [[containerURL path] UTF8String];
    if (!path) return NULL;

    return strdup(path);
}


void stride_macos_widget_free_string(char *ptr) {
    free(ptr);
}
