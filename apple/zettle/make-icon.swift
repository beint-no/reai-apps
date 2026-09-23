import AppKit
import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        NSColor(calibratedRed: 0.10, green: 0.43, blue: 0.62, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: pixels, height: pixels), xRadius: CGFloat(pixels)/5, yRadius: CGFloat(pixels)/5).fill()
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: CGFloat(pixels)*0.43, weight: .semibold), .foregroundColor: NSColor.white]
        let text = NSAttributedString(string: "Z→R", attributes: attributes)
        let bounds = text.size()
        text.draw(at: NSPoint(x: (CGFloat(pixels)-bounds.width)/2, y: (CGFloat(pixels)-bounds.height)/2))
        image.unlockFocus()
        let data = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
        try data.write(to: directory.appending(path: "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
    }
}
