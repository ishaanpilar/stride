import CoreFoundation
import Foundation

enum StrideWatchPayloadKind: String, CaseIterable {
    case text
    case audio
    case complete
    case deferTask = "defer"
    case pomodoro
    case checklist
}

struct StrideValidatedWatchPayload {
    let id: String
    let kind: StrideWatchPayloadKind
    let queuePayload: [String: Any]
}

enum StrideWatchPayloadValidationError: Error, Equatable {
    case invalidPayload
    case invalidField(String)
    case unsupportedKind
}

enum StrideWatchPayloadValidator {
    static let protocolVersion = 1
    static let source = "apple-watch"
    static let maxTitleCharacters = 2_000
    static let maxTitleBytes = 8_000
    static let maxTaskIdentifierBytes = 512
    static let maxFocusTasks = 20
    static let maxSnapshotTitleCharacters = 240
    static let maxApplicationContextBytes = 60 * 1_024

    private static let baseKeys: Set<String> = [
        "protocolVersion", "id", "createdAt", "source", "kind",
    ]

    private static let minimumTimestamp = Date(timeIntervalSince1970: 946_684_800)
    private static let maximumTimestamp = Date(timeIntervalSince1970: 4_102_444_800)

    private static let isoWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoWithoutFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func validateTransport(
        _ raw: [String: Any],
        expectedKind: StrideWatchPayloadKind? = nil
    ) throws -> StrideValidatedWatchPayload {
        guard integer(raw["protocolVersion"]) == protocolVersion else {
            throw StrideWatchPayloadValidationError.invalidField("protocolVersion")
        }
        guard raw["source"] as? String == source else {
            throw StrideWatchPayloadValidationError.invalidField("source")
        }
        guard let rawID = raw["id"] as? String,
              rawID.utf8.count == 36,
              let uuid = UUID(uuidString: rawID) else {
            throw StrideWatchPayloadValidationError.invalidField("id")
        }
        guard let kindValue = raw["kind"] as? String,
              let kind = StrideWatchPayloadKind(rawValue: kindValue) else {
            throw StrideWatchPayloadValidationError.unsupportedKind
        }
        if let expectedKind, kind != expectedKind {
            throw StrideWatchPayloadValidationError.invalidField("kind")
        }
        guard let createdAt = raw["createdAt"] as? String,
              validISO8601Timestamp(createdAt) else {
            throw StrideWatchPayloadValidationError.invalidField("createdAt")
        }

        let allowedKeys: Set<String>
        switch kind {
        case .checklist:
            allowedKeys = baseKeys.union(["taskId", "taskCreatedAt", "itemId", "itemTitle", "isCompleted"])
        case .text:
            allowedKeys = baseKeys.union(["title", "outboxRetried"])
        case .audio:
            allowedKeys = baseKeys.union(["outboxRetried"])
        case .complete:
            allowedKeys = baseKeys.union(["taskId"])
        case .deferTask:
            allowedKeys = baseKeys.union(["taskId", "startDate"])
        case .pomodoro:
            allowedKeys = baseKeys.union(["action", "taskId"])
        }
        guard Set(raw.keys).isSubset(of: allowedKeys) else {
            throw StrideWatchPayloadValidationError.invalidPayload
        }

        var queue: [String: Any] = [
            "protocolVersion": protocolVersion,
            "id": uuid.uuidString.lowercased(),
            "kind": kind.rawValue,
            "createdAt": createdAt,
            "source": source,
        ]
        if raw.keys.contains("outboxRetried") {
            guard strictBoolean(raw["outboxRetried"]) == true else {
                throw StrideWatchPayloadValidationError.invalidField("outboxRetried")
            }
            queue["outboxRetried"] = true
        }

        switch kind {
        case .checklist:
            queue["taskId"] = try taskIdentifier(raw["taskId"])
            queue["itemId"] = try taskIdentifier(raw["itemId"])
            guard let taskCreatedAt = raw["taskCreatedAt"] as? String, validISO8601Timestamp(taskCreatedAt),
                  let itemTitle = raw["itemTitle"] as? String, itemTitle.utf8.count <= 8_000,
                  let isCompleted = strictBoolean(raw["isCompleted"]) else {
                throw StrideWatchPayloadValidationError.invalidField("checklist")
            }
            queue["taskCreatedAt"] = taskCreatedAt
            queue["itemTitle"] = itemTitle
            queue["isCompleted"] = isCompleted
        case .text:
            guard let title = boundedTitle(raw["title"], maxCharacters: maxTitleCharacters, maxBytes: maxTitleBytes) else {
                throw StrideWatchPayloadValidationError.invalidField("title")
            }
            queue["title"] = title
        case .audio:
            break
        case .complete:
            queue["taskId"] = try taskIdentifier(raw["taskId"])
        case .deferTask:
            queue["taskId"] = try taskIdentifier(raw["taskId"])
            guard let startDate = raw["startDate"] as? String, validDateOnly(startDate) else {
                throw StrideWatchPayloadValidationError.invalidField("startDate")
            }
            queue["startDate"] = startDate
        case .pomodoro:
            guard let action = raw["action"] as? String,
                  ["start", "pause", "reset"].contains(action) else {
                throw StrideWatchPayloadValidationError.invalidField("action")
            }
            queue["action"] = action
            if raw.keys.contains("taskId") {
                queue["taskId"] = try taskIdentifier(raw["taskId"])
            }
        }

        return StrideValidatedWatchPayload(
            id: uuid.uuidString.lowercased(),
            kind: kind,
            queuePayload: queue
        )
    }

    static func normalizeApplicationContext(_ raw: [String: Any]) throws -> [String: Any] {
        guard let stripped = stripNullValues(raw) as? [String: Any],
              Set(stripped.keys) == Set(["protocolVersion", "generatedAt", "focus", "pomodoro"]) else {
            throw StrideWatchPayloadValidationError.invalidPayload
        }
        guard integer(stripped["protocolVersion"]) == protocolVersion else {
            throw StrideWatchPayloadValidationError.invalidField("protocolVersion")
        }
        guard let generatedAt = stripped["generatedAt"] as? String,
              validISO8601Timestamp(generatedAt) else {
            throw StrideWatchPayloadValidationError.invalidField("generatedAt")
        }
        guard let rawFocus = stripped["focus"] as? [[String: Any]],
              rawFocus.count <= maxFocusTasks else {
            throw StrideWatchPayloadValidationError.invalidField("focus")
        }

        let focus: [[String: Any]] = try rawFocus.map { item in
            guard Set(item.keys).isSubset(of: ["id", "title", "createdAt", "description", "checklist", "detailsUnavailable"]) else {
                throw StrideWatchPayloadValidationError.invalidField("focus")
            }
            let id = try taskIdentifier(item["id"])
            guard let title = boundedTitle(
                item["title"],
                maxCharacters: maxSnapshotTitleCharacters,
                maxBytes: maxSnapshotTitleCharacters * 4
            ) else {
                throw StrideWatchPayloadValidationError.invalidField("focus.title")
            }
            var result: [String: Any] = ["id": id, "title": title]
            if let value = item["createdAt"] {
                guard let date = value as? String, validISO8601Timestamp(date) else {
                    throw StrideWatchPayloadValidationError.invalidField("focus.createdAt")
                }
                result["createdAt"] = date
            }
            if let value = item["description"] {
                guard let description = value as? String, description.utf8.count <= 16 * 1024 else {
                    throw StrideWatchPayloadValidationError.invalidField("focus.description")
                }
                result["description"] = description
            }
            if let value = item["checklist"] {
                guard let checklist = value as? [[String: Any]], checklist.count <= 100 else {
                    throw StrideWatchPayloadValidationError.invalidField("focus.checklist")
                }
                result["checklist"] = try checklist.map { entry -> [String: Any] in
                    guard Set(entry.keys) == Set(["id", "title", "isCompleted"]),
                          let title = entry["title"] as? String, title.utf8.count <= 8_000,
                          let completed = strictBoolean(entry["isCompleted"]) else {
                        throw StrideWatchPayloadValidationError.invalidField("focus.checklist")
                    }
                    return ["id": try taskIdentifier(entry["id"]), "title": title, "isCompleted": completed]
                }
            }
            if let value = item["detailsUnavailable"] {
                guard let unavailable = strictBoolean(value) else {
                    throw StrideWatchPayloadValidationError.invalidField("focus.detailsUnavailable")
                }
                result["detailsUnavailable"] = unavailable
            }
            return result
        }

        guard let rawPomodoro = stripped["pomodoro"] as? [String: Any] else {
            throw StrideWatchPayloadValidationError.invalidField("pomodoro")
        }
        let pomodoroAllowedKeys: Set<String> = [
            "phase", "isRunning", "remainingSeconds", "phaseEndTime", "taskId", "taskTitle",
            "completionAlert",
        ]
        guard Set(rawPomodoro.keys).isSubset(of: pomodoroAllowedKeys),
              Set(rawPomodoro.keys).isSuperset(
                of: Set(["phase", "isRunning", "remainingSeconds"])
              ) else {
            throw StrideWatchPayloadValidationError.invalidField("pomodoro")
        }
        guard let phase = rawPomodoro["phase"] as? String,
              ["focus", "break"].contains(phase) else {
            throw StrideWatchPayloadValidationError.invalidField("pomodoro.phase")
        }
        guard let isRunning = rawPomodoro["isRunning"] as? Bool else {
            throw StrideWatchPayloadValidationError.invalidField("pomodoro.isRunning")
        }
        guard let remainingSeconds = integer(rawPomodoro["remainingSeconds"]),
              (0...86_400).contains(remainingSeconds) else {
            throw StrideWatchPayloadValidationError.invalidField("pomodoro.remainingSeconds")
        }

        var pomodoro: [String: Any] = [
            "phase": phase,
            "isRunning": isRunning,
            "remainingSeconds": remainingSeconds,
        ]
        if rawPomodoro.keys.contains("phaseEndTime") {
            guard let phaseEndTime = number(rawPomodoro["phaseEndTime"]),
                  phaseEndTime.isFinite,
                  phaseEndTime >= minimumTimestamp.timeIntervalSince1970 * 1_000,
                  phaseEndTime <= maximumTimestamp.timeIntervalSince1970 * 1_000 else {
                throw StrideWatchPayloadValidationError.invalidField("pomodoro.phaseEndTime")
            }
            pomodoro["phaseEndTime"] = phaseEndTime
        }
        if rawPomodoro.keys.contains("taskId") {
            pomodoro["taskId"] = try taskIdentifier(rawPomodoro["taskId"])
        }
        if rawPomodoro.keys.contains("taskTitle") {
            guard pomodoro["taskId"] != nil,
                  let taskTitle = boundedTitle(
                    rawPomodoro["taskTitle"],
                    maxCharacters: maxSnapshotTitleCharacters,
                    maxBytes: maxSnapshotTitleCharacters * 4
                  ) else {
                throw StrideWatchPayloadValidationError.invalidField("pomodoro.taskTitle")
            }
            pomodoro["taskTitle"] = taskTitle
        }
        if rawPomodoro.keys.contains("completionAlert") {
            guard let completionAlert = rawPomodoro["completionAlert"] as? Bool else {
                throw StrideWatchPayloadValidationError.invalidField("pomodoro.completionAlert")
            }
            pomodoro["completionAlert"] = completionAlert
        }

        var normalized: [String: Any] = [
            "protocolVersion": protocolVersion,
            "generatedAt": generatedAt,
            "focus": focus,
            "pomodoro": pomodoro,
        ]


        var boundedFocus = focus
        while let data = try? PropertyListSerialization.data(fromPropertyList: normalized, format: .binary, options: 0),
              data.count > maxApplicationContextBytes,
              let index = boundedFocus.lastIndex(where: { $0["description"] != nil || $0["checklist"] != nil }) {
            boundedFocus[index] = ["id": boundedFocus[index]["id"]!, "title": boundedFocus[index]["title"]!, "detailsUnavailable": true]
            normalized["focus"] = boundedFocus
        }
        guard PropertyListSerialization.propertyList(normalized, isValidFor: .binary),
              let encoded = try? PropertyListSerialization.data(
                fromPropertyList: normalized,
                format: .binary,
                options: 0
              ),
              encoded.count <= maxApplicationContextBytes else {
            throw StrideWatchPayloadValidationError.invalidPayload
        }
        return normalized
    }

    static func validDateOnly(_ raw: String) -> Bool {
        guard raw.utf8.count == 10 else { return false }
        let parts = raw.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts[0].count == 4,
              parts[1].count == 2,
              parts[2].count == 2,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let day = Int(parts[2]),
              (2000...2100).contains(year) else {
            return false
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = DateComponents(
            calendar: calendar,
            timeZone: calendar.timeZone,
            year: year,
            month: month,
            day: day
        )
        guard let date = calendar.date(from: components) else { return false }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
        return roundTrip.year == year && roundTrip.month == month && roundTrip.day == day
    }

    private static func validISO8601Timestamp(_ raw: String) -> Bool {
        guard !raw.isEmpty, raw.utf8.count <= 35,
              let date = isoWithFractionalSeconds.date(from: raw)
                ?? isoWithoutFractionalSeconds.date(from: raw) else {
            return false
        }
        return date >= minimumTimestamp && date <= maximumTimestamp
    }

    private static func boundedTitle(_ value: Any?, maxCharacters: Int, maxBytes: Int) -> String? {
        guard let raw = value as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              trimmed.count <= maxCharacters,
              trimmed.utf8.count <= maxBytes,
              !trimmed.unicodeScalars.contains(where: { $0.value == 0 }) else {
            return nil
        }
        return trimmed
    }

    private static func taskIdentifier(_ value: Any?) throws -> String {
        guard let raw = value as? String,
              raw == raw.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              raw.utf8.count <= maxTaskIdentifierBytes,
              !raw.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw StrideWatchPayloadValidationError.invalidField("taskId")
        }
        return raw
    }

    private static func integer(_ value: Any?) -> Int? {
        if let value = value as? NSNumber {
            guard CFGetTypeID(value) != CFBooleanGetTypeID() else { return nil }
            return Int(exactly: value.doubleValue)
        }
        return value as? Int
    }

    private static func number(_ value: Any?) -> Double? {
        if let value = value as? NSNumber {
            guard CFGetTypeID(value) != CFBooleanGetTypeID() else { return nil }
            return value.doubleValue
        }
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        return nil
    }

    private static func strictBoolean(_ value: Any?) -> Bool? {
        guard let value = value as? NSNumber,
              CFGetTypeID(value) == CFBooleanGetTypeID() else {
            return nil
        }
        return value.boolValue
    }

    private static func stripNullValues(_ value: Any) -> Any? {
        if value is NSNull { return nil }
        if let dictionary = value as? [String: Any] {
            var result: [String: Any] = [:]
            for (key, child) in dictionary {
                if let stripped = stripNullValues(child) {
                    result[key] = stripped
                }
            }
            return result
        }
        if let array = value as? [Any] {
            return array.compactMap(stripNullValues)
        }
        return value
    }
}
