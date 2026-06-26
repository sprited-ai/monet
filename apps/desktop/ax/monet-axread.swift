// monet-axread — on-device screen-text via the macOS Accessibility API (no pixels, ever).
//
// Reads the text the frontmost app already exposes to assistive tech (its AX tree) — exact strings,
// no capture, no OCR. Needs the **Accessibility** permission (System Settings → Privacy & Security →
// Accessibility), granted to the app that launches this (Electron in the overlay). Nothing leaves
// the machine; this just prints the focused window's visible text to stdout.
//
// Build:  swiftc -O monet-axread.swift -o monet-axread
// Use:    monet-axread          # prints the text
//         monet-axread --count  # prints only stats (no content) — for safe verification

import Foundation
import AppKit
import ApplicationServices

let err = FileHandle.standardError
func die(_ m: String, _ c: Int32) -> Never { err.write((m + "\n").data(using: .utf8)!); exit(c) }

let countOnly = CommandLine.arguments.contains("--count")

// Permission gate. Prompt once if not yet trusted.
let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
if !AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary) {
  die("not trusted: grant Accessibility in System Settings → Privacy & Security → Accessibility", 3)
}

guard let frontApp = NSWorkspace.shared.frontmostApplication else { die("no frontmost app", 1) }
let axApp = AXUIElementCreateApplication(frontApp.processIdentifier)

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

// Prefer the focused window; fall back to the app element itself.
var root = axApp
if let w = attr(axApp, kAXFocusedWindowAttribute as String) { root = (w as! AXUIElement) }

let MAX_NODES = 6000
let MAX_CHARS = 20000
var nodes = 0
var chars = 0
var seen = Set<String>()
var out: [String] = []

func walk(_ el: AXUIElement, _ depth: Int) {
  if nodes >= MAX_NODES || chars >= MAX_CHARS || depth > 80 { return }
  nodes += 1
  for name in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] as [String] {
    if let s = attr(el, name) as? String {
      let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
      if t.count >= 2 && !seen.contains(t) {
        seen.insert(t); out.append(t); chars += t.count
      }
    }
  }
  if let kids = attr(el, kAXChildrenAttribute as String) as? [AXUIElement] {
    for k in kids { walk(k, depth + 1) }
  }
}
walk(root, 0)

if countOnly {
  print("trusted=true app=\(frontApp.localizedName ?? "?") nodes=\(nodes) textBlocks=\(out.count) chars=\(chars)")
} else {
  print(out.joined(separator: "\n"))
}
