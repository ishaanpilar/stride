#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#include <dispatch/dispatch.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

static NSString *stride_permission_status_string(EKAuthorizationStatus status) {
    if (status == EKAuthorizationStatusNotDetermined) {
        return @"undetermined";
    }
    if (status == EKAuthorizationStatusRestricted || status == EKAuthorizationStatusDenied) {
        return @"denied";
    }
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 140000


    if (@available(macOS 14.0, *)) {
        if (status == EKAuthorizationStatusWriteOnly) {
            return @"denied";
        }
        if (status == EKAuthorizationStatusFullAccess) {
            return @"granted";
        }
    }
#endif
    if (status == EKAuthorizationStatusAuthorized) {
        return @"granted";
    }
    return @"denied";
}

static char *stride_copy_json(id object) {
    if (!object || ![NSJSONSerialization isValidJSONObject:object]) {
        return strdup("{\"error\":\"invalid-json\"}");
    }
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:&error];
    if (!data || error) {
        return strdup("{\"error\":\"json-encode-failed\"}");
    }
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!json) {
        return strdup("{\"error\":\"json-encode-failed\"}");
    }
    const char *utf8 = [json UTF8String];
    return utf8 ? strdup(utf8) : strdup("{\"error\":\"json-encode-failed\"}");
}

static char *stride_copy_null_json(void) {
    return strdup("null");
}

static NSDate *stride_parse_iso_date(const char *raw) {
    if (!raw) return nil;
    NSString *text = [NSString stringWithUTF8String:raw];
    if (!text || [text length] == 0) return nil;

    NSISO8601DateFormatter *fractional = [[NSISO8601DateFormatter alloc] init];
    fractional.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
    NSDate *parsed = [fractional dateFromString:text];
    if (parsed) return parsed;

    NSISO8601DateFormatter *basic = [[NSISO8601DateFormatter alloc] init];
    basic.formatOptions = NSISO8601DateFormatWithInternetDateTime;
    return [basic dateFromString:text];
}

static NSString *stride_trimmed_string(NSString *value) {
    if (!value) return nil;
    NSString *trimmed = [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    return [trimmed length] > 0 ? trimmed : nil;
}

static BOOL stride_is_stride_calendar(EKCalendar *calendar) {
    NSString *title = [stride_trimmed_string(calendar.title) lowercaseString];
    return title && [title isEqualToString:@"stride"];
}

static NSString *stride_calendar_color_hex(EKCalendar *calendar) {
    CGColorRef color = calendar.CGColor;
    if (!color) return nil;
    size_t count = CGColorGetNumberOfComponents(color);
    const CGFloat *components = CGColorGetComponents(color);
    if (!components || count < 3) return nil;

    CGFloat red = components[0];
    CGFloat green = components[1];
    CGFloat blue = components[2];
    if (count == 2) {
        red = components[0];
        green = components[0];
        blue = components[0];
    }
    return [NSString stringWithFormat:@"#%02X%02X%02X",
            (unsigned int)lrint(MIN(MAX(red, 0), 1) * 255),
            (unsigned int)lrint(MIN(MAX(green, 0), 1) * 255),
            (unsigned int)lrint(MIN(MAX(blue, 0), 1) * 255)];
}

static NSDictionary *stride_calendar_push_payload(EKCalendar *calendar) {
    NSString *identifier = stride_trimmed_string(calendar.calendarIdentifier);
    if (!identifier || !calendar.allowsContentModifications) return nil;
    NSString *title = stride_trimmed_string(calendar.title) ?: @"Calendar";
    NSMutableDictionary *payload = [NSMutableDictionary dictionary];
    payload[@"id"] = identifier;
    payload[@"name"] = title;
    NSString *sourceName = stride_trimmed_string(calendar.source.title);
    if (sourceName) payload[@"sourceName"] = sourceName;
    NSString *sourceId = stride_trimmed_string(calendar.source.sourceIdentifier);
    if (sourceId) payload[@"sourceId"] = sourceId;
    NSString *color = stride_calendar_color_hex(calendar);
    if (color) payload[@"color"] = color;
    payload[@"isStrideDedicated"] = @(stride_is_stride_calendar(calendar));
    return payload;
}

static NSArray<NSDictionary *> *stride_writable_calendar_payloads(EKEventStore *store) {
    NSArray<EKCalendar *> *allCalendars = [store calendarsForEntityType:EKEntityTypeEvent];
    NSMutableArray<NSDictionary *> *payload = [NSMutableArray array];
    for (EKCalendar *calendar in allCalendars) {
        NSDictionary *item = stride_calendar_push_payload(calendar);
        if (item) [payload addObject:item];
    }
    [payload sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        BOOL aStride = [a[@"isStrideDedicated"] boolValue];
        BOOL bStride = [b[@"isStrideDedicated"] boolValue];
        if (aStride != bStride) return aStride ? NSOrderedAscending : NSOrderedDescending;
        NSString *aName = a[@"name"] ?: @"";
        NSString *bName = b[@"name"] ?: @"";
        return [aName localizedCaseInsensitiveCompare:bName];
    }];
    return payload;
}

static EKSource *stride_preferred_calendar_source(EKEventStore *store) {
    EKCalendar *defaultCalendar = [store defaultCalendarForNewEvents];
    if (defaultCalendar.source) return defaultCalendar.source;

    NSArray<EKSource *> *sources = [store sources];
    for (EKSource *source in sources) {
        if (source.sourceType == EKSourceTypeCalDAV || source.sourceType == EKSourceTypeExchange) {
            return source;
        }
    }
    for (EKSource *source in sources) {
        if (source.sourceType == EKSourceTypeLocal) return source;
    }
    return [sources firstObject];
}

static NSString *stride_source_type_string(EKSourceType type) {
    switch (type) {
        case EKSourceTypeLocal: return @"local";
        case EKSourceTypeExchange: return @"exchange";
        case EKSourceTypeCalDAV: return @"caldav";
        case EKSourceTypeMobileMe: return @"icloud";
        case EKSourceTypeSubscribed: return @"subscribed";
        case EKSourceTypeBirthdays: return @"birthdays";
    }
    return @"other";
}

static EKSource *stride_source_with_identifier(EKEventStore *store, NSString *sourceId) {
    if (!sourceId) return nil;
    for (EKSource *source in [store sources]) {
        if ([source.sourceIdentifier isEqualToString:sourceId]) return source;
    }
    return nil;
}

static NSArray<NSDictionary *> *stride_account_source_payloads(EKEventStore *store) {
    NSMutableArray<NSDictionary *> *payload = [NSMutableArray array];
    for (EKSource *source in [store sources]) {
        if (source.sourceType == EKSourceTypeSubscribed || source.sourceType == EKSourceTypeBirthdays) continue;
        NSString *identifier = stride_trimmed_string(source.sourceIdentifier);
        if (!identifier) continue;
        NSMutableDictionary *item = [NSMutableDictionary dictionary];
        item[@"id"] = identifier;
        item[@"name"] = stride_trimmed_string(source.title) ?: @"Account";
        item[@"type"] = stride_source_type_string(source.sourceType);
        [payload addObject:item];
    }
    [payload sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        return [a[@"name"] localizedCaseInsensitiveCompare:b[@"name"]];
    }];
    return payload;
}

static NSDictionary *stride_calendar_write_error(NSString *error) {
    return @{@"ok": @NO, @"error": error ?: @"calendar-write-failed"};
}

static NSDictionary *stride_calendar_write_ok(NSString *eventId) {
    return @{
        @"ok": @YES,
        @"eventId": stride_trimmed_string(eventId) ?: @""
    };
}

static NSDictionary *stride_parse_event_payload(const char *event_json) {
    if (!event_json) return nil;
    NSString *raw = [NSString stringWithUTF8String:event_json];
    if (!raw) return nil;
    NSData *data = [raw dataUsingEncoding:NSUTF8StringEncoding];
    if (!data) return nil;
    id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    return [parsed isKindOfClass:[NSDictionary class]] ? parsed : nil;
}

static BOOL stride_apply_event_payload(EKEventStore *store, EKEvent *event, NSDictionary *payload, NSString **errorOut) {
    NSString *calendarId = stride_trimmed_string(payload[@"calendarId"]);
    NSString *title = stride_trimmed_string(payload[@"title"]) ?: @"Task";
    NSString *startRaw = stride_trimmed_string(payload[@"start"]);
    NSString *endRaw = stride_trimmed_string(payload[@"end"]);
    NSDate *startDate = startRaw ? stride_parse_iso_date([startRaw UTF8String]) : nil;
    NSDate *endDate = endRaw ? stride_parse_iso_date([endRaw UTF8String]) : nil;
    if (!calendarId || !startDate || !endDate) {
        if (errorOut) *errorOut = @"invalid-event";
        return NO;
    }
    if ([endDate timeIntervalSinceDate:startDate] <= 0) {
        endDate = [startDate dateByAddingTimeInterval:60 * 60];
    }

    EKCalendar *calendar = [store calendarWithIdentifier:calendarId];
    if (!calendar || !calendar.allowsContentModifications) {
        if (errorOut) *errorOut = @"calendar-unavailable";
        return NO;
    }

    event.calendar = calendar;
    event.title = title;
    event.startDate = startDate;
    event.endDate = endDate;
    event.allDay = [payload[@"allDay"] boolValue];
    NSString *notes = stride_trimmed_string(payload[@"notes"]);
    event.notes = notes;
    NSString *location = stride_trimmed_string(payload[@"location"]);
    event.location = location;
    return YES;
}

char *stride_macos_calendar_permission_status_json(void) {
    @autoreleasepool {
        NSString *status = stride_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        return stride_copy_json(@{@"status": status ?: @"denied"});
    }
}

char *stride_macos_calendar_request_permission_json(void) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        __block NSError *requestError = nil;
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        if (@available(macOS 14.0, *)) {
            [store requestFullAccessToEventsWithCompletion:^(BOOL granted, NSError *_Nullable error) {
                (void)granted;
                requestError = error;
                dispatch_semaphore_signal(semaphore);
            }];
        } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            [store requestAccessToEntityType:EKEntityTypeEvent completion:^(BOOL granted, NSError *_Nullable error) {
                (void)granted;
                requestError = error;
                dispatch_semaphore_signal(semaphore);
            }];
#pragma clang diagnostic pop
        }

        long waitResult = dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(20 * NSEC_PER_SEC)));

        NSMutableDictionary *payload = [NSMutableDictionary dictionary];
        NSString *status = stride_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        payload[@"status"] = status ?: @"denied";
        if (waitResult != 0) {
            payload[@"error"] = @"permission-request-timeout";
        } else if (requestError) {
            payload[@"error"] = [requestError localizedDescription] ?: @"permission-request-failed";
        }
        return stride_copy_json(payload);
    }
}

char *stride_macos_calendar_events_json(const char *range_start, const char *range_end) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        NSString *permission = stride_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        if (![permission isEqualToString:@"granted"]) {
            return stride_copy_json(@{
                @"permission": permission ?: @"denied",
                @"calendars": @[],
                @"events": @[]
            });
        }

        NSDate *startDate = stride_parse_iso_date(range_start);
        NSDate *endDate = stride_parse_iso_date(range_end);
        if (!startDate || !endDate) {
            return stride_copy_json(@{
                @"permission": permission ?: @"granted",
                @"calendars": @[],
                @"events": @[],
                @"error": @"invalid-range"
            });
        }

        NSArray<EKCalendar *> *allCalendars = [store calendarsForEntityType:EKEntityTypeEvent];
        NSMutableArray<EKCalendar *> *selectedCalendars = [NSMutableArray array];
        NSMutableArray<NSDictionary *> *calendarPayload = [NSMutableArray array];
        for (EKCalendar *calendar in allCalendars) {
            NSString *identifier = [calendar.calendarIdentifier stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!identifier || [identifier length] == 0) continue;
            [selectedCalendars addObject:calendar];

            NSString *title = [calendar.title stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!title || [title length] == 0) title = @"Calendar";
            NSString *encoded = [identifier stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet URLPathAllowedCharacterSet]];
            if (!encoded) encoded = identifier;
            NSMutableDictionary *calendarItem = [NSMutableDictionary dictionaryWithDictionary:@{
                @"id": [@"system:" stringByAppendingString:identifier],
                @"name": title,
                @"url": [@"system://" stringByAppendingString:encoded],
                @"enabled": @YES
            }];


            NSString *color = stride_calendar_color_hex(calendar);
            if (color) calendarItem[@"color"] = color;
            [calendarPayload addObject:calendarItem];
        }


        [calendarPayload sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
            NSString *aName = a[@"name"] ?: @"";
            NSString *bName = b[@"name"] ?: @"";
            NSComparisonResult result = [aName localizedCaseInsensitiveCompare:bName];
            if (result != NSOrderedSame) return result;
            NSString *aId = a[@"id"] ?: @"";
            NSString *bId = b[@"id"] ?: @"";
            return [aId compare:bId];
        }];

        NSPredicate *predicate = [store predicateForEventsWithStartDate:startDate endDate:endDate calendars:selectedCalendars];
        NSArray<EKEvent *> *events = [store eventsMatchingPredicate:predicate];

        NSISO8601DateFormatter *iso = [[NSISO8601DateFormatter alloc] init];
        iso.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;

        NSMutableArray<NSDictionary *> *eventPayload = [NSMutableArray arrayWithCapacity:[events count]];
        for (EKEvent *event in events) {
            NSDate *start = event.startDate;
            if (!start) continue;
            NSDate *end = event.endDate;
            NSTimeInterval fallback = event.allDay ? 24 * 60 * 60 : 60 * 60;
            if (!end) end = [start dateByAddingTimeInterval:fallback];
            if ([end timeIntervalSinceDate:start] <= 0) end = [start dateByAddingTimeInterval:fallback];

            NSString *calendarId = [event.calendar.calendarIdentifier stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!calendarId || [calendarId length] == 0) continue;

            NSString *sourceId = [@"system:" stringByAppendingString:calendarId];
            NSString *eventId = [[event eventIdentifier] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!eventId || [eventId length] == 0) eventId = [[NSUUID UUID] UUIDString];
            NSString *startIso = [iso stringFromDate:start];
            NSString *title = [[event title] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (!title || [title length] == 0) title = @"Event";

            NSMutableDictionary *item = [NSMutableDictionary dictionary];
            item[@"id"] = [NSString stringWithFormat:@"%@:%@:%@", sourceId, eventId, startIso];
            item[@"sourceId"] = sourceId;
            item[@"title"] = title;
            item[@"start"] = startIso;
            item[@"end"] = [iso stringFromDate:end];
            item[@"allDay"] = @(event.allDay);

            NSString *notes = [[event notes] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (notes && [notes length] > 0) item[@"description"] = notes;
            NSString *location = [[event location] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (location && [location length] > 0) item[@"location"] = location;

            [eventPayload addObject:item];
        }

        [eventPayload sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
            NSString *aStart = a[@"start"] ?: @"";
            NSString *bStart = b[@"start"] ?: @"";
            NSComparisonResult result = [aStart compare:bStart];
            if (result != NSOrderedSame) return result;
            NSString *aTitle = a[@"title"] ?: @"";
            NSString *bTitle = b[@"title"] ?: @"";
            return [aTitle compare:bTitle];
        }];

        return stride_copy_json(@{
            @"permission": permission ?: @"granted",
            @"calendars": calendarPayload,
            @"events": eventPayload
        });
    }
}

char *stride_macos_writable_calendars_json(void) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        NSString *permission = stride_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        if (![permission isEqualToString:@"granted"]) return stride_copy_json(@[]);
        return stride_copy_json(stride_writable_calendar_payloads(store));
    }
}

char *stride_macos_calendar_sources_json(void) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        NSString *permission = stride_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        if (![permission isEqualToString:@"granted"]) return stride_copy_json(@[]);
        return stride_copy_json(stride_account_source_payloads(store));
    }
}

char *stride_macos_ensure_stride_calendar_json(const char *stored_calendar_id, const char *source_id) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        NSString *permission = stride_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        if (![permission isEqualToString:@"granted"]) return stride_copy_null_json();

        NSString *storedId = stride_trimmed_string(stored_calendar_id ? [NSString stringWithUTF8String:stored_calendar_id] : nil);
        NSString *wantedSourceId = stride_trimmed_string(source_id ? [NSString stringWithUTF8String:source_id] : nil);
        EKSource *wantedSource = stride_source_with_identifier(store, wantedSourceId);
        // A chosen account that no longer exists must not silently fall back to another account.
        if (wantedSourceId && !wantedSource) return stride_copy_null_json();

        if (storedId) {
            EKCalendar *stored = [store calendarWithIdentifier:storedId];
            BOOL inWantedSource = !wantedSource || [stored.source.sourceIdentifier isEqualToString:wantedSource.sourceIdentifier];
            NSDictionary *storedPayload = (stored && inWantedSource) ? stride_calendar_push_payload(stored) : nil;
            if (storedPayload) return stride_copy_json(storedPayload);
        }

        NSArray<EKCalendar *> *allCalendars = [store calendarsForEntityType:EKEntityTypeEvent];
        for (EKCalendar *calendar in allCalendars) {
            if (!stride_is_stride_calendar(calendar)) continue;
            if (wantedSource && ![calendar.source.sourceIdentifier isEqualToString:wantedSource.sourceIdentifier]) continue;
            NSDictionary *payload = stride_calendar_push_payload(calendar);
            if (payload) return stride_copy_json(payload);
        }

        EKSource *source = wantedSource ?: stride_preferred_calendar_source(store);
        if (!source) return stride_copy_null_json();

        EKCalendar *calendar = [EKCalendar calendarForEntityType:EKEntityTypeEvent eventStore:store];
        calendar.title = @"Stride";
        calendar.source = source;
        CGColorRef blue = CGColorCreateGenericRGB(0.231, 0.510, 0.965, 1.0);
        if (blue) {
            calendar.CGColor = blue;
            CGColorRelease(blue);
        }

        NSError *error = nil;
        if (![store saveCalendar:calendar commit:YES error:&error]) {
            return stride_copy_null_json();
        }
        NSDictionary *payload = stride_calendar_push_payload(calendar);
        return payload ? stride_copy_json(payload) : stride_copy_null_json();
    }
}

char *stride_macos_create_calendar_event_json(const char *event_json) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        NSString *permission = stride_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        if (![permission isEqualToString:@"granted"]) return stride_copy_json(stride_calendar_write_error(@"permission-denied"));

        NSDictionary *payload = stride_parse_event_payload(event_json);
        if (!payload) return stride_copy_json(stride_calendar_write_error(@"invalid-event"));

        EKEvent *event = [EKEvent eventWithEventStore:store];
        NSString *applyError = nil;
        if (!stride_apply_event_payload(store, event, payload, &applyError)) {
            return stride_copy_json(stride_calendar_write_error(applyError));
        }

        NSError *error = nil;
        if (![store saveEvent:event span:EKSpanThisEvent commit:YES error:&error]) {
            return stride_copy_json(stride_calendar_write_error([error localizedDescription] ?: @"calendar-write-failed"));
        }
        return stride_copy_json(stride_calendar_write_ok(event.eventIdentifier));
    }
}

char *stride_macos_update_calendar_event_json(const char *event_id, const char *event_json) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        NSString *permission = stride_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        if (![permission isEqualToString:@"granted"]) return stride_copy_json(stride_calendar_write_error(@"permission-denied"));

        NSString *eventId = stride_trimmed_string(event_id ? [NSString stringWithUTF8String:event_id] : nil);
        if (!eventId) return stride_copy_json(stride_calendar_write_error(@"event-not-found"));
        EKEvent *event = [store eventWithIdentifier:eventId];
        if (!event) return stride_copy_json(stride_calendar_write_error(@"event-not-found"));

        NSDictionary *payload = stride_parse_event_payload(event_json);
        if (!payload) return stride_copy_json(stride_calendar_write_error(@"invalid-event"));
        NSString *applyError = nil;
        if (!stride_apply_event_payload(store, event, payload, &applyError)) {
            return stride_copy_json(stride_calendar_write_error(applyError));
        }

        NSError *error = nil;
        if (![store saveEvent:event span:EKSpanThisEvent commit:YES error:&error]) {
            return stride_copy_json(stride_calendar_write_error([error localizedDescription] ?: @"calendar-write-failed"));
        }
        return stride_copy_json(stride_calendar_write_ok(event.eventIdentifier ?: eventId));
    }
}

char *stride_macos_delete_calendar_event_json(const char *event_id) {
    @autoreleasepool {
        EKEventStore *store = [[EKEventStore alloc] init];
        NSString *permission = stride_permission_status_string([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
        if (![permission isEqualToString:@"granted"]) return stride_copy_json(stride_calendar_write_error(@"permission-denied"));

        NSString *eventId = stride_trimmed_string(event_id ? [NSString stringWithUTF8String:event_id] : nil);
        if (!eventId) return stride_copy_json(stride_calendar_write_ok(nil));
        EKEvent *event = [store eventWithIdentifier:eventId];
        if (!event) return stride_copy_json(stride_calendar_write_ok(eventId));

        NSError *error = nil;
        if (![store removeEvent:event span:EKSpanThisEvent commit:YES error:&error]) {
            return stride_copy_json(stride_calendar_write_error([error localizedDescription] ?: @"calendar-delete-failed"));
        }
        return stride_copy_json(stride_calendar_write_ok(eventId));
    }
}

void stride_macos_calendar_free_string(char *value) {
    if (value) free(value);
}
