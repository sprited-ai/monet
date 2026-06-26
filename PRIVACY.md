# Privacy

Monet reads your screen and talks to a model. So privacy isn't a footnote — it's the
reason this is **BYOK** and **open source**. Here is exactly what moves, and what doesn't.

## What leaves your machine

| Data | Goes where | When |
|---|---|---|
| Your messages + the screen *text* she's allowed to see | **directly to `api.anthropic.com`**, with **your** key | only when you talk to her (or she reads the screen on your action) |
| (that's it) | | |

## What never leaves your machine

- **Your API key.** Stored locally — macOS Keychain via Electron `safeStorage` (encrypted), or a `0600` file if the OS can't encrypt. Held only in the app's **main process**. Sent only to `api.anthropic.com`. The web page that renders her **never sees it**.
- **Screen pixels.** Screen reading is **on-device**:
  - **Accessibility** (default): reads the text apps already expose to assistive tech. **No pixels are ever captured.**
  - **OCR** (opt-in fallback, Apple Vision): runs locally; the screenshot is **deleted the instant** text is extracted. Only the resulting *text* is used, and it goes into your prompt to your own key.
- **Anything, to us.** We run **no server in your conversation.** Your chat and screen text bypass Sprited entirely.

## What we *do* serve

Her **body** — the static render assets (the character art/animation) — is loaded from
`monet.sprited.ai`, like any web page loads images. That's a one-way asset fetch; **no
conversation, screen text, or key is ever sent to it.** (A future release will let you bundle
her body locally for a fully-offline install.)

## No account, no telemetry

There is no sign-up, no analytics, no usage beacon in this build. (If we ever add anything
optional, it will be **opt-in and documented here** — never on by default.)

## Don't trust us — read it

The whole point of open-sourcing this is that you don't have to take our word for it:

- The key + the Anthropic call live in **`byok.js`** and **`main.js`** (search `api.anthropic.com`).
- The chat-rerouting seam is a few lines in **`preload.js`** (it patches the page's `fetch`).
- The screen readers are two small Swift programs: **`ax/monet-axread.swift`**, **`ocr/monet-ocr.swift`**.

If you find anything that contradicts this document, that's a bug — please open an issue.

## Permissions you'll be asked for (macOS)

- **Accessibility** — only if you turn on screen reading (default path). Lets her read exposed UI text.
- **Screen Recording** — only if you opt into the OCR fallback. Never fires on its own.

You can run her with **no key and no permissions** — she'll just be present, idling on your desktop.
