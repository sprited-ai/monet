// monet-ocr — on-device screen-text extraction for the desktop overlay.
//
// Pure image→text: takes an image path, runs Apple's Vision OCR (VNRecognizeTextRequest), prints the
// recognized lines to stdout. No capture, no network — the capture step (Apple's `screencapture`)
// happens upstream, so this helper needs no Screen Recording permission of its own. Everything stays
// on the machine; only the extracted text is emitted, and only when the overlay asks.
//
// Build:  swiftc -O monet-ocr.swift -o monet-ocr
// Use:    monet-ocr /path/to/frame.png

import Foundation
import Vision
import AppKit

let err = FileHandle.standardError
func die(_ msg: String, _ code: Int32) -> Never {
  err.write((msg + "\n").data(using: .utf8)!)
  exit(code)
}

guard CommandLine.arguments.count > 1 else { die("usage: monet-ocr <image-path>", 2) }
let path = CommandLine.arguments[1]

guard let image = NSImage(contentsOfFile: path),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else { die("cannot load image: \(path)", 1) }

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
// Auto-detect per region — this reads mixed Korean+English screens correctly AND keeps English code
// casing intact. (A fixed recognitionLanguages order forces a trade-off: en-first drops Korean,
// ko-first mangles code casing.) Fall back to an explicit ko+en order on older macOS.
if #available(macOS 13.0, *) {
  request.automaticallyDetectsLanguage = true
} else {
  request.recognitionLanguages = ["ko-KR", "en-US"]
}

do {
  try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
  die("ocr failed: \(error)", 1)
}

let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
