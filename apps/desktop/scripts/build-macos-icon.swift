// Run from apps/desktop with `swift scripts/build-macos-icon.swift`.
import AppKit

let source = NSImage(contentsOfFile: "assets/supahelp.png")!
var sourceRect = CGRect(x: 0, y: 0, width: 1024, height: 1024)
let image = source.cgImage(forProposedRect: &sourceRect, context: nil, hints: nil)!
let mark = image.cropping(to: CGRect(x: 360, y: 375, width: 290, height: 275))!
let iconset = "assets/supahelp.iconset"
try FileManager.default.createDirectory(atPath: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(atPath: iconset) }
for size in [16, 32, 64, 128, 256, 512, 1024] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!.cgContext
    context.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    context.setFillColor(NSColor.white.cgColor)
    context.addPath(CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824),
        cornerWidth: 185, cornerHeight: 185, transform: nil))
    context.fillPath()
    context.interpolationQuality = .high
    context.draw(mark, in: CGRect(x: 337, y: 346, width: 350, height: 332))
    let png = bitmap.representation(using: .png, properties: [:])!
    if size == 1024 { try png.write(to: URL(fileURLWithPath: "assets/supahelp-macos.png")) }
    if size <= 512 { try png.write(to: URL(fileURLWithPath: "\(iconset)/icon_\(size)x\(size).png")) }
    if size >= 32 { try png.write(to: URL(fileURLWithPath: "\(iconset)/icon_\(size/2)x\(size/2)@2x.png")) }
}
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset, "-o", "assets/supahelp.icns"]
try task.run()
task.waitUntilExit()
precondition(task.terminationStatus == 0)
