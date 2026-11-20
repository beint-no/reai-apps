import AppKit
import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let p = CGFloat(size * scale)
        let image = NSImage(size: NSSize(width: p, height: p))
        image.lockFocus()
        NSColor(calibratedRed: 0.15, green: 0.35, blue: 0.48, alpha: 1).setFill()
        NSBezierPath(roundedRect: CGRect(x: 0, y: 0, width: p, height: p), xRadius: p / 5, yRadius: p / 5).fill()
        NSColor.white.setFill()
        NSBezierPath(roundedRect: CGRect(x: p * 0.3, y: p * 0.22, width: p * 0.4, height: p * 0.58),
                     xRadius: p * 0.05, yRadius: p * 0.05).fill()
        NSColor(calibratedRed: 0.15, green: 0.35, blue: 0.48, alpha: 1).setFill()
        for y in [0.65, 0.53, 0.41] {
            NSBezierPath(roundedRect: CGRect(x: p * 0.38, y: p * y, width: p * 0.24, height: p * 0.035),
                         xRadius: p * 0.015, yRadius: p * 0.015).fill()
        }
        image.unlockFocus()
        let data = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
        try data.write(to: directory.appending(path: "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
    }
}
