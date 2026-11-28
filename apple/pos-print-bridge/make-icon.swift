import AppKit
import Foundation

// A receipt slip with a torn edge on a dark green tile.
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = CGFloat(size * scale)
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        NSColor(calibratedRed: 0.08, green: 0.33, blue: 0.18, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: pixels, height: pixels), xRadius: pixels / 5, yRadius: pixels / 5).fill()
        let left = pixels * 0.28, right = pixels * 0.72, top = pixels * 0.84, bottom = pixels * 0.18
        let slip = NSBezierPath()
        slip.move(to: NSPoint(x: left, y: top))
        slip.line(to: NSPoint(x: right, y: top))
        slip.line(to: NSPoint(x: right, y: bottom))
        let teeth = 5
        let step = (right - left) / CGFloat(teeth)
        for tooth in 0..<teeth {
            let x = right - CGFloat(tooth) * step
            slip.line(to: NSPoint(x: x - step / 2, y: bottom + pixels * 0.05))
            slip.line(to: NSPoint(x: x - step, y: bottom))
        }
        slip.close()
        NSColor.white.setFill()
        slip.fill()
        NSColor(calibratedRed: 0.08, green: 0.33, blue: 0.18, alpha: 0.85).setFill()
        for (index, width) in [0.32, 0.24, 0.32].enumerated() {
            let y = top - pixels * (0.14 + CGFloat(index) * 0.11)
            NSBezierPath(rect: NSRect(x: left + pixels * 0.06, y: y, width: pixels * CGFloat(width), height: max(1, pixels * 0.04))).fill()
        }
        NSColor(calibratedRed: 0.53, green: 0.94, blue: 0.67, alpha: 1).setFill()
        NSBezierPath(rect: NSRect(x: left + pixels * 0.06, y: bottom + pixels * 0.12, width: right - left - pixels * 0.12, height: max(1, pixels * 0.06))).fill()
        image.unlockFocus()
        let data = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
        try data.write(to: directory.appending(path: "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
    }
}
