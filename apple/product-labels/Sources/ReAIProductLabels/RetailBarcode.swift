import CoreGraphics
import Foundation

enum RetailBarcode {
    // GS1 EAN/UPC digit patterns. Right-hand digits are the complement of left odd-parity digits.
    private static let left = ["0001101", "0011001", "0010011", "0111101", "0100011",
                               "0110001", "0101111", "0111011", "0110111", "0001011"]
    private static let parity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
                                 "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]

    static func image(for value: String, width: CGFloat) throws -> CGImage? {
        let bytes = Array(value.utf8)
        guard [8, 12, 13].contains(bytes.count), bytes.allSatisfy({ (48...57).contains($0) }) else { return nil }
        var digits = bytes.map { Int($0) - 48 }
        let checksum = digits.reversed().enumerated().reduce(0) { $0 + $1.element * ($1.offset.isMultiple(of: 2) ? 1 : 3) }
        guard checksum.isMultiple(of: 10) else { return nil }
        if digits.count == 12 { digits.insert(0, at: 0) }
        let ean8 = digits.count == 8
        let leftDigits = ean8 ? digits[0..<4] : digits[1..<7]
        let sides = ean8 ? "LLLL" : parity[digits[0]]
        let right = left.map { String($0.map { $0 == "0" ? Character("1") : Character("0") }) }
        var modules = String(repeating: "0", count: ean8 ? 7 : 11) + "101"
        for (digit, side) in zip(leftDigits, sides) {
            modules += side == "L" ? left[digit] : String(right[digit].reversed())
        }
        modules += "01010"
        for digit in digits.suffix(ean8 ? 4 : 6) { modules += right[digit] }
        modules += "101" + String(repeating: "0", count: bytes.count == 12 ? 9 : 7)
        guard width / CGFloat(modules.count) >= 0.75 else { throw appError("Choose a wider label for this retail barcode.") }
        let data = Data(modules.utf8.map { $0 == 49 ? 0 : UInt8(255) })
        guard let provider = CGDataProvider(data: data as CFData),
              let image = CGImage(width: modules.count, height: 1, bitsPerComponent: 8, bitsPerPixel: 8,
                                  bytesPerRow: modules.count, space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: [], provider: provider, decode: nil,
                                  shouldInterpolate: false, intent: .defaultIntent) else { throw appError("Could not render the barcode.") }
        return image
    }
}
