import AppKit

let destination = URL(filePath: CommandLine.arguments[1])
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = CGFloat(size * scale)
        let image = NSImage(size: NSSize(width: pixels, height: pixels), flipped: false) { _ in
            NSColor(srgbRed: 0.11, green: 0.17, blue: 0.34, alpha: 1).setFill()
            NSBezierPath(roundedRect: NSRect(x: pixels * 0.05, y: pixels * 0.05,
                                             width: pixels * 0.9, height: pixels * 0.9),
                         xRadius: pixels * 0.21, yRadius: pixels * 0.21).fill()
            NSColor(srgbRed: 0.72, green: 0.88, blue: 1, alpha: 1).setFill()
            for row in 0..<3 {
                let y = pixels * (0.28 + CGFloat(row) * 0.19)
                let dot = NSRect(x: pixels * 0.24, y: y, width: pixels * 0.10, height: pixels * 0.10)
                NSBezierPath(ovalIn: dot).fill()
                let line = NSRect(x: pixels * 0.42, y: y, width: pixels * 0.34, height: pixels * 0.10)
                NSBezierPath(roundedRect: line, xRadius: pixels * 0.05, yRadius: pixels * 0.05).fill()
            }
            return true
        }
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: destination.appending(path: name))
    }
}
