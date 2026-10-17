import AppKit
let destination = CommandLine.arguments[1]
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels), flipped: false) { _ in
            let s = CGFloat(pixels)
            NSColor(calibratedRed: 0.05, green: 0.25, blue: 0.27, alpha: 1).setFill()
            NSBezierPath(roundedRect: NSRect(x: s*0.04, y: s*0.04, width: s*0.92, height: s*0.92), xRadius: s*0.20, yRadius: s*0.20).fill()
            NSColor(calibratedRed: 0.60, green: 0.96, blue: 0.80, alpha: 1).setStroke()
            let house = NSBezierPath(); house.move(to: NSPoint(x:s*0.21,y:s*0.48)); house.line(to:NSPoint(x:s*0.5,y:s*0.77)); house.line(to:NSPoint(x:s*0.79,y:s*0.48)); house.move(to:NSPoint(x:s*0.30,y:s*0.53)); house.line(to:NSPoint(x:s*0.30,y:s*0.25)); house.line(to:NSPoint(x:s*0.70,y:s*0.25)); house.line(to:NSPoint(x:s*0.70,y:s*0.53)); house.lineWidth=s*0.045; house.lineJoinStyle = .round; house.stroke()
            let arrow=NSBezierPath(); arrow.move(to:NSPoint(x:s*0.4,y:s*0.42)); arrow.line(to:NSPoint(x:s*0.6,y:s*0.42)); arrow.line(to:NSPoint(x:s*0.54,y:s*0.48)); arrow.move(to:NSPoint(x:s*0.6,y:s*0.42)); arrow.line(to:NSPoint(x:s*0.54,y:s*0.36)); arrow.lineWidth=s*0.035; arrow.stroke()
            return true
        }
        let bitmap = NSBitmapImageRep(data:image.tiffRepresentation!)!
        try bitmap.representation(using:.png,properties:[:])!.write(to:URL(filePath:destination).appending(path:"icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
    }
}
