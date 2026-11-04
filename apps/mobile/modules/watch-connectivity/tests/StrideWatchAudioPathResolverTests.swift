import Foundation
import XCTest
@testable import StrideWatchPayloadValidation

final class StrideWatchAudioPathResolverTests: XCTestCase {
    private let id = "9d8a4448-255f-4c49-a40b-1855fa86be2d"
    private let currentDocuments = URL(
        fileURLWithPath: "/var/mobile/Containers/Data/Application/NEW/Documents",
        isDirectory: true
    )

    func testRebasesRetainedOriginalFromPreviousContainer() {
        let stored = "file:///var/mobile/Containers/Data/Application/OLD/Documents/watch-audio-original/\(id).m4a"
        XCTAssertEqual(
            StrideWatchAudioPathResolver.rebase(
                absoluteString: stored,
                id: id,
                kind: .retainedOriginal,
                currentDocumentsURL: currentDocuments
            ),
            currentDocuments.appendingPathComponent("watch-audio-original/\(id).m4a")
        )
    }

    func testRebasesWaveFromPreviousContainer() {
        let stored = "file:///private/var/mobile/Containers/Data/Application/OLD/Documents/watch-audio/\(id).wav"
        XCTAssertEqual(
            StrideWatchAudioPathResolver.rebase(
                absoluteString: stored,
                id: id,
                kind: .wave,
                currentDocumentsURL: currentDocuments
            ),
            currentDocuments.appendingPathComponent("watch-audio/\(id).wav")
        )
    }

    func testRejectsWrongDirectoryExtensionIdentifierAndTraversal() {
        let invalid = [
            "file:///old/Documents/watch-audio/\(id).m4a",
            "file:///old/Documents/watch-audio/not-a-uuid.wav",
            "file:///old/Documents/watch-audio/../watch-audio/\(id).wav",
            "file:///old/Documents/other/\(id).wav",
            "file:///old/Documents/watch-audio/\(id).wav?replacement=1",
        ]
        for stored in invalid {
            XCTAssertNil(StrideWatchAudioPathResolver.rebase(
                absoluteString: stored,
                id: id,
                kind: .wave,
                currentDocumentsURL: currentDocuments
            ), stored)
        }
    }

    func testRejectsNonCanonicalOrMismatchedUUIDOwnership() {
        let upper = id.uppercased()
        let stored = "file:///old/Documents/watch-audio/\(upper).wav"
        XCTAssertNil(StrideWatchAudioPathResolver.rebase(
            absoluteString: stored,
            id: upper,
            kind: .wave,
            currentDocumentsURL: currentDocuments
        ))

        XCTAssertNil(StrideWatchAudioPathResolver.rebase(
            absoluteString: "file:///old/Documents/watch-audio/\(id).wav",
            id: "11111111-1111-4111-8111-111111111111",
            kind: .wave,
            currentDocumentsURL: currentDocuments
        ))
    }
}
