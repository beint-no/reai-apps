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
        // A page with a folded corner.
        let page = NSBezierPath()
        page.move(to: NSPoint(x: 330, y: 250))
        page.line(to: NSPoint(x: 694, y: 250))
        page.line(to: NSPoint(x: 694, y: 664))
        page.line(to: NSPoint(x: 600, y: 774))
        page.line(to: NSPoint(x: 330, y: 774))
        page.close()
        NSColor.white.withAlphaComponent(0.96).setFill()
        page.fill()
        NSColor(red: 0.05, green: 0.48, blue: 0.50, alpha: 1).setStroke()
        for y in [620, 545, 470] {
            let line = NSBezierPath()
            line.lineWidth = 26
            line.lineCapStyle = .round
            line.move(to: NSPoint(x: 400, y: y))
            line.line(to: NSPoint(x: y == 470 ? 540 : 624, y: y))
            line.stroke()
        }
        // Viewfinder corners around the page.
        let corners = NSBezierPath()
        corners.lineWidth = 34
        corners.lineCapStyle = .round
        corners.lineJoinStyle = .round
        for (x, y, dx, dy) in [(232.0, 196.0, 1.0, 1.0), (792.0, 196.0, -1.0, 1.0), (232.0, 828.0, 1.0, -1.0), (792.0, 828.0, -1.0, -1.0)] {
            corners.move(to: NSPoint(x: x, y: y + dy * 120))
            corners.line(to: NSPoint(x: x, y: y))
            corners.line(to: NSPoint(x: x + dx * 120, y: y))
        }
        NSColor.white.withAlphaComponent(0.9).setStroke()
        corners.stroke()
        // The scan line.
        let scan = NSBezierPath(roundedRect: NSRect(x: 262, y: 372, width: 500, height: 30), xRadius: 15, yRadius: 15)
        NSColor(red: 0.55, green: 0.98, blue: 0.86, alpha: 1).setFill()
        scan.fill()
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
