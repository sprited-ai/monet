// Screen-read — platform seam.
//
// main.js calls `readAccessibility()` / `readOCR()` without knowing the OS. Each platform drops in
// a `<platform>.js` module exporting those two functions (see darwin.js for the reference shape and
// README.md for the contract). macOS is implemented; Windows and Linux are open extension points —
// uncomment the case below and add the module. On a platform with no implementation the app still
// runs fully; screen-read just reports unavailable, so the brain falls back to chat-only.

let impl = null
switch (process.platform) {
  case 'darwin':
    impl = require('./darwin')
    break
  // case 'win32': impl = require('./win32') break   // ← UI Automation (text) + an OCR engine
  // case 'linux': impl = require('./linux') break    // ← AT-SPI (text) + Tesseract/OCR
  default:
    impl = null
}

const unavailable = () =>
  Promise.resolve({
    ok: false,
    error: `screen reading isn't implemented on ${process.platform} yet — see apps/desktop/screenread/README.md to add it`,
  })

module.exports = {
  // Whether on-device screen reading exists on this OS (the UI can hide the affordance if not).
  available: !!impl,
  platform: process.platform,
  readAccessibility: impl ? impl.readAccessibility : unavailable,
  readOCR: impl ? impl.readOCR : unavailable,
}
