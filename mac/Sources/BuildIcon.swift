import AppKit
import Foundation

let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
var iconChunks = Data()
func networkInteger(_ value: Int) -> Data {
    var integer = UInt32(value).bigEndian
    return withUnsafeBytes(of: &integer) { Data($0) }
}
let chunkTypes = ["16-1":"icp4", "16-2":"ic11", "32-1":"icp5", "32-2":"ic12",
                  "128-1":"ic07", "128-2":"ic13", "256-1":"ic08", "256-2":"ic14",
                  "512-1":"ic09", "512-2":"ic10"]
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let context = NSGraphicsContext(bitmapImageRep: rep)!
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
        let transform = NSAffineTransform(); transform.scale(by: CGFloat(pixels) / 1024); transform.concat()
        let base = NSBezierPath(roundedRect: NSRect(x: 48, y: 48, width: 928, height: 928), xRadius: 205, yRadius: 205)
        NSGradient(colors: [NSColor(calibratedRed: 0.035, green: 0.039, blue: 0.047, alpha: 1),
                            NSColor(calibratedRed: 0.078, green: 0.086, blue: 0.102, alpha: 1)])!
            .draw(in: base, angle: 90)
        NSColor.white.withAlphaComponent(0.055).setStroke(); base.lineWidth = 2; base.stroke()
        let blue = NSColor(calibratedRed: 0.584, green: 0.733, blue: 0.929, alpha: 1)
        let halo = NSBezierPath(ovalIn: NSRect(x: 184, y: 184, width: 656, height: 656))
        blue.withAlphaComponent(0.11).setStroke(); halo.lineWidth = 3; halo.stroke()
        let orb = NSBezierPath(ovalIn: NSRect(x: 248, y: 248, width: 528, height: 528))
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.7)
        shadow.shadowBlurRadius = 52; shadow.shadowOffset = NSSize(width: 0, height: -28); shadow.set()
        NSGradient(colors: [NSColor(calibratedRed: 0.88, green: 0.895, blue: 0.925, alpha: 1),
                            NSColor(calibratedRed: 0.58, green: 0.61, blue: 0.66, alpha: 1),
                            NSColor(calibratedRed: 0.23, green: 0.27, blue: 0.32, alpha: 1),
                            NSColor(calibratedRed: 0.07, green: 0.09, blue: 0.12, alpha: 1)])!
            .draw(in: orb, relativeCenterPosition: NSPoint(x: -0.4, y: 0.4))
        NSGraphicsContext.restoreGraphicsState()
        NSColor.white.withAlphaComponent(0.19).setStroke(); orb.lineWidth = 1.5; orb.stroke()
        NSGraphicsContext.saveGraphicsState()
        let tilt = NSAffineTransform(); tilt.translateX(by: 512, yBy: 512)
        tilt.rotate(byDegrees: -24); tilt.translateX(by: -512, yBy: -512); tilt.concat()
        let orbit = NSBezierPath(ovalIn: NSRect(x: 174, y: 401, width: 676, height: 222))
        NSColor.white.withAlphaComponent(0.2).setStroke(); orbit.lineWidth = 2; orbit.stroke()
        NSGraphicsContext.restoreGraphicsState()
        blue.withAlphaComponent(0.95).setFill()
        NSBezierPath(ovalIn: NSRect(x: 754, y: 351, width: 17, height: 17)).fill()
        NSGraphicsContext.restoreGraphicsState()
        let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
        let png = rep.representation(using: .png, properties: [:])!
        try png.write(to: destination.appendingPathComponent(name))
        iconChunks.append(Data(chunkTypes["\(size)-\(scale)"]!.utf8))
        iconChunks.append(networkInteger(png.count + 8))
        iconChunks.append(png)
    }
}
if CommandLine.arguments.count > 2 {
    var icon = Data("icns".utf8)
    icon.append(networkInteger(iconChunks.count + 8))
    icon.append(iconChunks)
    try icon.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
}
