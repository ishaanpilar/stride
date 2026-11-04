import CloudKit
import Foundation


enum CloudKitAttachmentErrorClassifier {
    static let strideErrorDomain = "StrideCloudKit"
    static let recordNotFoundCode = 1002
    static let assetMissingCode = 1003

    static func isTerminalNotFound(_ error: Error) -> Bool {
        let nsError = error as NSError
        if nsError.domain == strideErrorDomain {
            return nsError.code == recordNotFoundCode || nsError.code == assetMissingCode
        }
        return nsError.domain == CKErrorDomain
            && nsError.code == CKError.Code.unknownItem.rawValue
    }
}
