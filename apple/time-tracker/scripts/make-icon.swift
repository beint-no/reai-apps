import AppKit

let destination = CommandLine.arguments[1]
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels), flipped: false) { _ in
            let side = CGFloat(pixels)
            NSColor(calibratedRed: 0.04, green: 0.21, blue: 0.24, alpha: 1).setFill()
            NSBezierPath(roundedRect: NSRect(x: side * 0.04, y: side * 0.04, width: side * 0.92, height: side * 0.92),
                         xRadius: side * 0.20, yRadius: side * 0.20).fill()
            NSColor(calibratedRed: 0.47, green: 0.94, blue: 0.77, alpha: 1).setStroke()
            let ring = NSBezierPath(ovalIn: NSRect(x: side * 0.23, y: side * 0.20, width: side * 0.54, height: side * 0.54))
            ring.lineWidth = side * 0.045
            ring.stroke()
            let hand = NSBezierPath()
            hand.move(to: NSPoint(x: side * 0.50, y: side * 0.65))
            hand.line(to: NSPoint(x: side * 0.50, y: side * 0.47))
            hand.line(to: NSPoint(x: side * 0.62, y: side * 0.40))
            hand.lineWidth = side * 0.045
            hand.lineCapStyle = .round
            hand.stroke()
            let crown = NSBezierPath()
            crown.move(to: NSPoint(x: side * 0.43, y: side * 0.82))
            crown.line(to: NSPoint(x: side * 0.57, y: side * 0.82))
            crown.lineWidth = side * 0.05
            crown.lineCapStyle = .round
            crown.stroke()
            return true
        }
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to:
            URL(filePath: destination).appending(path: "icon_\(size)x\(size)\(suffix).png"))
    }
}
