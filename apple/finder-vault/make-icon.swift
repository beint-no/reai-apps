import AppKit

let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)

for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let transform = NSAffineTransform()
        transform.scale(by: CGFloat(pixels) / 1024)
        transform.concat()
        let background = NSBezierPath(roundedRect: NSRect(x: 52, y: 52, width: 920, height: 920), xRadius: 210, yRadius: 210)
        NSGradient(starting: NSColor(red: 0.04, green: 0.72, blue: 0.68, alpha: 1),
            ending: NSColor(red: 0.02, green: 0.23, blue: 0.30, alpha: 1))!.draw(in: background, angle: -75)
        let page = NSBezierPath(roundedRect: NSRect(x: 290, y: 320, width: 444, height: 420), xRadius: 48, yRadius: 48)
        NSColor.white.withAlphaComponent(0.95).setFill()
        page.fill()
        NSColor(red: 0.05, green: 0.48, blue: 0.50, alpha: 1).setStroke()
        for y in [640, 565] {
            let line = NSBezierPath()
            line.lineWidth = 28
            line.lineCapStyle = .round
            line.move(to: NSPoint(x: 370, y: y))
            line.line(to: NSPoint(x: 654, y: y))
            line.stroke()
        }
        let tray = NSBezierPath(roundedRect: NSRect(x: 216, y: 238, width: 592, height: 225), xRadius: 55, yRadius: 55)
        NSColor(red: 0.02, green: 0.30, blue: 0.35, alpha: 1).setFill()
        tray.fill()
        tray.lineWidth = 14
        NSColor.white.withAlphaComponent(0.8).setStroke()
        tray.stroke()
        let handle = NSBezierPath(roundedRect: NSRect(x: 433, y: 331, width: 158, height: 25), xRadius: 12, yRadius: 12)
        NSColor.white.setFill()
        handle.fill()
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
