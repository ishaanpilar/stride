import CloudKit
import Darwin
import Foundation

@main
struct SwiftTaskMapperFixtureCheck {
    static func main() throws {
        let arguments = CommandLine.arguments
        guard arguments.count >= 2 else {
            throw NSError(
                domain: "StrideTaskMapperFixture",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Usage: checker <fixture-path> [field ...]"]
            )
        }

        let fixtureData = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
        guard
            let root = try JSONSerialization.jsonObject(with: fixtureData) as? [String: Any],
            let fixture = root["fixture"] as? [String: Any],
            let fixtureID = fixture["id"]
        else {
            throw NSError(
                domain: "StrideTaskMapperFixture",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Fixture file has no fixture object"]
            )
        }

        let zoneID = CKRecordZone.ID(
            zoneName: "StrideFixtureZone",
            ownerName: CKCurrentUserDefaultName
        )
        guard let record = CloudKitRecordMapper.record(
            from: fixture,
            recordType: CloudKitRecordMapper.taskType,
            zoneID: zoneID
        ) else {
            throw NSError(
                domain: "StrideTaskMapperFixture",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Swift mapper rejected the fixture"]
            )
        }

        let actual = CloudKitRecordMapper.json(from: record)
        var expected: [String: Any] = ["id": fixtureID]
        for field in arguments.dropFirst(2) {
            if let value = fixture[field] {
                expected[field] = value
            }
        }

        guard (actual as NSDictionary).isEqual(expected as NSDictionary) else {
            let expectedJSON = try JSONSerialization.data(withJSONObject: expected, options: [.prettyPrinted, .sortedKeys])
            let actualJSON = try JSONSerialization.data(withJSONObject: actual, options: [.prettyPrinted, .sortedKeys])
            FileHandle.standardError.write(Data("Swift task mapper fixture mismatch\nexpected:\n".utf8))
            FileHandle.standardError.write(expectedJSON)
            FileHandle.standardError.write(Data("\nactual:\n".utf8))
            FileHandle.standardError.write(actualJSON)
            FileHandle.standardError.write(Data("\n".utf8))
            Darwin.exit(1)
        }
    }
}
