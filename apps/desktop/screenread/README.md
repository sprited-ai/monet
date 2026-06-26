# screenread — the platform seam for on-device screen reading

Monet's brain can read what's on your screen, **locally and on demand**. *How* that text is obtained
is OS-specific, so it lives behind this seam. The shell (`main.js`) only ever calls the two functions
below — it never knows which OS it's on.

The being itself is cross-platform: the Electron shell, the render, and the BYOK brain run anywhere.
Screen-read is the one capability that needs a per-OS implementation. Where there isn't one yet,
everything else still works — the brain just falls back to chat without screen context.

## The contract

Each platform provides a `<platform>.js` (matching `process.platform`: `darwin`, `win32`, `linux`)
exporting:

```js
module.exports = {
  // Read text the focused app exposes to assistive tech. No pixels. Preferred (exact strings).
  readAccessibility(): Promise<{ ok: true, via: string, text: string } | { ok: false, error: string }>,

  // Opt-in fallback for apps that expose no accessible text (canvas/games): capture a frame, OCR it
  // locally, delete the frame immediately. Only the extracted text is returned.
  readOCR():           Promise<{ ok: true, via: string, text: string } | { ok: false, error: string }>,
}
```

Then register it in `index.js` (uncomment the `case`). That's the whole integration.

**Privacy contract (non-negotiable, all platforms):** accessibility reads text without capturing
pixels; OCR deletes its frame the instant text is extracted; only the resulting *text* leaves the
function; nothing persists and nothing is uploaded.

## Status

| OS | Accessibility | OCR | Notes |
|---|---|---|---|
| **macOS** (`darwin`) | ✅ AX tree via a Swift helper | ✅ `screencapture` + Apple Vision | reference implementation |
| **Windows** (`win32`) | ⬜ open | ⬜ open | suggested: UI Automation for text; Windows.Media.Ocr or Tesseract |
| **Linux** (`linux`) | ⬜ open | ⬜ open | suggested: AT-SPI (`at-spi2`) for text; Tesseract for OCR |

Contributions welcome — a `win32.js` or `linux.js` that satisfies the contract above is a small,
high-impact PR. You don't need to touch anything outside this directory.
