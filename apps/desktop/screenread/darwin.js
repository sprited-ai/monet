// Screen-read — macOS implementation (the reference platform).
//
// Accessibility (default): a Swift helper reads the text the frontmost app exposes to the AX tree.
// No pixels are ever captured — exact strings. OCR (opt-in fallback): `screencapture` grabs a frame,
// Apple Vision extracts text, and the frame is deleted the instant OCR finishes. Either way only the
// extracted TEXT leaves these functions; nothing persists.
//
// Both helpers are built from Swift by `npm run build:native` (postinstall). If swiftc isn't present
// the binaries are absent and these resolve `{ ok: false }` cleanly — the app still runs.

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { execFile } = require('node:child_process')

const AX_BIN = path.join(__dirname, '..', 'ax', 'monet-axread')
const OCR_BIN = path.join(__dirname, '..', 'ocr', 'monet-ocr')

function readAccessibility() {
  return new Promise((resolve) => {
    execFile(AX_BIN, [], { maxBuffer: 16 * 1024 * 1024 }, (e, stdout) => {
      if (e) {
        const msg = e.code === 3
          ? 'grant Accessibility (System Settings → Privacy & Security → Accessibility)'
          : `ax read failed: ${e.message}`
        return resolve({ ok: false, error: msg })
      }
      resolve({ ok: true, via: 'accessibility', text: (stdout || '').trim() })
    })
  })
}

function readOCR() {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `monet-screen-${process.pid}-${Date.now()}.png`)
    execFile('/usr/sbin/screencapture', ['-x', '-t', 'png', tmp], (capErr) => {
      if (capErr) return resolve({ ok: false, error: `capture failed (grant Screen Recording?): ${capErr.message}` })
      execFile(OCR_BIN, [tmp], { maxBuffer: 16 * 1024 * 1024 }, (ocrErr, stdout) => {
        fs.unlink(tmp, () => {}) // the frame's pixels are gone the instant OCR is done
        if (ocrErr) return resolve({ ok: false, error: `ocr failed (built monet-ocr?): ${ocrErr.message}` })
        resolve({ ok: true, via: 'ocr', text: (stdout || '').trim() })
      })
    })
  })
}

module.exports = { readAccessibility, readOCR }
