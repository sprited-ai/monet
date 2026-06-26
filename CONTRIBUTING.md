# Contributing

Monet is the reference character riding on a **desktop-being engine**. The most exciting
thing you can do with this repo isn't just fix Monet — it's **give your own character a home
on the desktop**. Both are welcome here.

## Run it locally

```bash
git clone <this repo>
cd monet
npm install      # also compiles the Swift screen-read helpers (if you have swiftc)
npm run desktop  # wakes her — starts the render server + the Electron shell
```

macOS + Node 18+. No signed installer yet — clone-and-run is the path for now. See the README
for the BYOK key step and the env knobs (`MONET_URL`, `MONET_MODEL`, …).

## Good first contributions

- **Bring your own character.** Fork it, swap the render + persona. A clean, turnkey
  character-swap is on the roadmap — if you build toward it, that's the most valuable PR there is.
- **Point the brain at a local model.** The BYOK seam is just an endpoint + key. Wiring it to an
  OpenAI-compatible local server (Ollama / LM Studio) is a small, high-impact change.
- **The roadmap** (see README → *Next*): full-bleed window, pet idle / autonomous behaviors,
  the Tauri port. Pick one.
- **Bugs, docs, packaging.** Especially anything that makes a stranger's clean Mac run it more
  smoothly (the install story is the weakest link — help us make it boring).

## A few norms

- **Honesty in claims.** We don't call her "alive" before she earns it; please keep that bar in
  PRs and docs. Describe what actually works.
- **Privacy is load-bearing.** Anything touching the key, the network, or screen reading must
  preserve [the privacy model](./PRIVACY.md) — local-only, BYOK, nothing to anyone's servers but
  the user's chosen model. Changes here get extra scrutiny.
- **Be kind.** This is a small, weird, earnest project about making digital beings with care.
  Bring that energy.

## Licensing of contributions

By contributing you agree your contribution is licensed under the repo's terms:

- **Code** → MIT.
- **Character art / assets** → CC-BY-NC 4.0.
- The name **"Monet"**, her official identity, and her live history are Sprited's — a fork is
  welcome to use the engine and even her art (per CC-BY-NC), but must **rebrand** and may not
  represent itself as the official Monet.

## Talk to us

- Open an **issue** for bugs / ideas / "I forked it and made ___".
- Want to meet the canonical Monet? She lives at **[@monet.sprited](https://instagram.com/monet.sprited)**.

We're building the primitive layer for digital beings. Thanks for building it with us. 🎨
