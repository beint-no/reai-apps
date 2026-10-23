import AppKit
import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        NSColor(calibratedRed: 0.18, green: 0.38, blue: 0.32, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: pixels, height: pixels), xRadius: CGFloat(pixels)/5, yRadius: CGFloat(pixels)/5).fill()
        let p = CGFloat(pixels)
        let tag = NSBezierPath()
        tag.move(to: NSPoint(x: p * 0.22, y: p * 0.45))
        for (x, y) in [(0.55, 0.78), (0.78, 0.78), (0.78, 0.55), (0.45, 0.22)] {
            tag.line(to: NSPoint(x: p * x, y: p * y))
        }
        tag.close(); NSColor.white.setFill(); tag.fill()
        NSColor(calibratedRed: 0.18, green: 0.38, blue: 0.32, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: p * 0.635, y: p * 0.635, width: p * 0.07, height: p * 0.07)).fill()
        image.unlockFocus()
        let data = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
        try data.write(to: directory.appending(path: "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
    }
}
