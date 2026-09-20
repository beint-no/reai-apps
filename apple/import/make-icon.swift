import AppKit
let destination = CommandLine.arguments[1]
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels), flipped: false) { _ in
            let s = CGFloat(pixels)
            NSColor(calibratedRed: 0.08, green: 0.20, blue: 0.29, alpha: 1).setFill()
            NSBezierPath(roundedRect: NSRect(x: s * 0.04, y: s * 0.04, width: s * 0.92, height: s * 0.92), xRadius: s * 0.20, yRadius: s * 0.20).fill()
            NSColor(calibratedRed: 0.46, green: 0.92, blue: 0.79, alpha: 1).setStroke()
            let grid = NSBezierPath(roundedRect: NSRect(x: s * 0.21, y: s * 0.22, width: s * 0.58, height: s * 0.40), xRadius: s * 0.04, yRadius: s * 0.04)
            grid.lineWidth = s * 0.035; grid.stroke()
            let lines = NSBezierPath()
            lines.move(to: NSPoint(x: s * 0.22, y: s * 0.42)); lines.line(to: NSPoint(x: s * 0.78, y: s * 0.42))
            lines.move(to: NSPoint(x: s * 0.41, y: s * 0.23)); lines.line(to: NSPoint(x: s * 0.41, y: s * 0.61))
            lines.move(to: NSPoint(x: s * 0.61, y: s * 0.23)); lines.line(to: NSPoint(x: s * 0.61, y: s * 0.61))
            lines.lineWidth = s * 0.022; lines.stroke()
            NSColor.white.setStroke()
            let arrow = NSBezierPath(); arrow.move(to: NSPoint(x: s * 0.5, y: s * 0.84)); arrow.line(to: NSPoint(x: s * 0.5, y: s * 0.55))
            arrow.move(to: NSPoint(x: s * 0.40, y: s * 0.65)); arrow.line(to: NSPoint(x: s * 0.5, y: s * 0.55)); arrow.line(to: NSPoint(x: s * 0.60, y: s * 0.65))
            arrow.lineWidth = s * 0.045; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round; arrow.stroke()
            return true
        }
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(filePath: destination).appending(path: "icon_\(size)x\(size)\(suffix).png"))
    }
}
