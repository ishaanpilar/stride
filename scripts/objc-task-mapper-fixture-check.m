#import <Foundation/Foundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern char *stride_cloudkit_round_trip_task_json(const char *json_utf8);

static void print_json(NSDictionary *object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object
                                                   options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys
                                                     error:nil];
    if (data) fwrite(data.bytes, 1, data.length, stderr);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) {
            fprintf(stderr, "Usage: checker <fixture-path> [field ...]\n");
            return 1;
        }

        NSData *fixtureData = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]];
        NSError *error = nil;
        id rootObject = fixtureData
            ? [NSJSONSerialization JSONObjectWithData:fixtureData options:0 error:&error]
            : nil;
        if (error || ![rootObject isKindOfClass:[NSDictionary class]]) {
            fprintf(stderr, "Could not read task schema fixture\n");
            return 1;
        }

        NSDictionary *fixture = ((NSDictionary *)rootObject)[@"fixture"];
        if (![fixture isKindOfClass:[NSDictionary class]]) {
            fprintf(stderr, "Fixture file has no fixture object\n");
            return 1;
        }

        NSData *inputData = [NSJSONSerialization dataWithJSONObject:fixture options:0 error:&error];
        if (!inputData || error) {
            fprintf(stderr, "Could not encode fixture input\n");
            return 1;
        }
        NSString *inputJSON = [[NSString alloc] initWithData:inputData encoding:NSUTF8StringEncoding];
        char *outputJSON = stride_cloudkit_round_trip_task_json(inputJSON.UTF8String);
        if (!outputJSON) {
            fprintf(stderr, "Objective-C mapper rejected the fixture\n");
            return 1;
        }

        NSData *outputData = [NSData dataWithBytes:outputJSON length:strlen(outputJSON)];
        free(outputJSON);
        id outputObject = [NSJSONSerialization JSONObjectWithData:outputData options:0 error:&error];
        if (error || ![outputObject isKindOfClass:[NSDictionary class]]) {
            fprintf(stderr, "Objective-C mapper returned invalid JSON\n");
            return 1;
        }

        NSMutableDictionary *expected = [NSMutableDictionary dictionary];
        if (fixture[@"id"]) expected[@"id"] = fixture[@"id"];
        for (int i = 2; i < argc; i++) {
            NSString *field = [NSString stringWithUTF8String:argv[i]];
            if (fixture[field]) expected[field] = fixture[field];
        }

        NSDictionary *actual = (NSDictionary *)outputObject;
        if (![actual isEqualToDictionary:expected]) {
            fprintf(stderr, "Objective-C task mapper fixture mismatch\nexpected:\n");
            print_json(expected);
            fprintf(stderr, "\nactual:\n");
            print_json(actual);
            fprintf(stderr, "\n");
            return 1;
        }
    }
    return 0;
}
