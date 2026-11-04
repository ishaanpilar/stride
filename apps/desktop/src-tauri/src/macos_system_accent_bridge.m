#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef void (*StrideSystemAccentChangedCallback)(void);

static id strideSystemAccentColorsObserver = nil;
static id strideSystemAccentPrefsObserver = nil;

// Returns the current NSColor.controlAccentColor as a malloc'd "#RRGGBB" string in sRGB, or NULL.
// Free with stride_macos_system_accent_free_string.
char *stride_macos_system_accent_hex(void) {
    @autoreleasepool {
        if (![NSColor respondsToSelector:@selector(controlAccentColor)]) {
            return NULL;
        }
        NSColor *accent = [NSColor controlAccentColor];
        NSColor *srgb = [accent colorUsingColorSpace:[NSColorSpace sRGBColorSpace]];
        if (srgb == nil) {
            return NULL;
        }
        CGFloat r = 0, g = 0, b = 0, a = 0;
        [srgb getRed:&r green:&g blue:&b alpha:&a];
        int ri = (int)lround(fmin(fmax(r, 0.0), 1.0) * 255.0);
        int gi = (int)lround(fmin(fmax(g, 0.0), 1.0) * 255.0);
        int bi = (int)lround(fmin(fmax(b, 0.0), 1.0) * 255.0);
        char *out = (char *)malloc(8);
        if (out == NULL) {
            return NULL;
        }
        snprintf(out, 8, "#%02X%02X%02X", ri, gi, bi);
        return out;
    }
}

void stride_macos_system_accent_free_string(char *ptr) {
    if (ptr) free(ptr);
}

// Observes the accent-colour change notifications. Idempotent.
bool stride_macos_install_system_accent_listener(StrideSystemAccentChangedCallback callback) {
    if (callback == NULL || strideSystemAccentColorsObserver != nil) {
        return false;
    }
    strideSystemAccentColorsObserver = [[NSNotificationCenter defaultCenter]
        addObserverForName:NSSystemColorsDidChangeNotification
                    object:nil
                     queue:nil
                usingBlock:^(NSNotification *note) { callback(); }];
    // Changing the accent in System Settings is also broadcast system-wide.
    strideSystemAccentPrefsObserver = [[NSDistributedNotificationCenter defaultCenter]
        addObserverForName:@"AppleColorPreferencesChangedNotification"
                    object:nil
                     queue:nil
                usingBlock:^(NSNotification *note) { callback(); }];
    return true;
}
