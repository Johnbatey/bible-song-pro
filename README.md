# Bible Song Pro – OBS Overlay for Bible Verses & Song Lyrics

A modern church presentation system for OBS Studio that lets you display Bible verses and song lyrics in real-time.

This is a fork of the original masterpiece from ![Johnson Olakotan](https://github.com/Johnbatey/bible-song-pro-obs)

---

## Preview

### Fresh Look in v2.1.0

![New Interface v2.1.0](Bible%20Song%20Pro_Screenshot/New%20Interface%20v2.1.0.png)
![New Interface v2.1.0 2](Bible%20Song%20Pro_Screenshot/New%20Interface%20V2.1.0%202.png)
![Ai Helper](Bible%20Song%20Pro_Screenshot/Ai%20Helper.png)
![AI Assistant Window](Bible%20Song%20Pro_Screenshot/AI%20Assistant%20Window.png)

### Core Workflows

![Lowerthird Mode](Bible%20Song%20Pro_Screenshot/Lowerthird%20Mode.png)
![Auto Retrieve Lyrics](Bible%20Song%20Pro_Screenshot/Auto-Retrieve%20Lyrics%2002.png)
![Languages Preview](Bible%20Song%20Pro_Screenshot/Support%20for%2050+%20Languages%2002.png)

---

## Get Started

👉 Download the latest version: [Download Here](https://github.com/Johnbatey/bible-song-pro-obs/releases/latest)

👉 Watch demo: [YouTube Demo](https://www.youtube.com/watch?v=4SVs5jyYx3o)

---

## Features

- Real-time Bible verse display
- Auto-Retrieve Lyrics
- Real-time song lyrics presentation
- Clean broadcast-style UI
- Fully customizable display
- Lightweight and fast
- Works directly inside OBS Browser Source
- Increased Lines tab
- Ref and Text content auto-adjusts based screen view-width
- **AI Scripture Assistant** — real-time speech detection that listens to your sermon and instantly surfaces Bible references as you speak, keeping your operator always one step ahead
- **Independent Lower Third & Full Screen backgrounds** — set a different visual background for each display mode, with a one-click Link button to mirror both simultaneously

---

## What Is New In v2.1.0 (Compared To OBS-2)

### New Features Added

- **AI Scripture Assistant (Live Scripture HUD)** — a floating, real-time detection panel that listens to spoken audio during worship or preaching and automatically identifies Bible references and song cues. Works for both Bible verse projection and song lyrics display. Runs fully offline with Local AI (Moonshine) or in the cloud via Deepgram — no interruption to your flow
- **Independent Lower Third and Full Screen Backgrounds** — Lower Third and Full Screen modes now each carry their own dedicated background layer (solid color, image, video, or YouTube). A single Link toggle instantly mirrors both modes to the same background whenever consistency is needed
- Dedicated AI Helper desktop app with relay-based control and a clean companion UI
- Cross-platform helper packaging for macOS (Intel and Apple Silicon), Windows (installer and portable), and Linux (AppImage and zip)
- New feedback pipeline: local backend and Cloudflare Worker deployment option for public issue intake
- Expanded vMix workflow support with display URL tools, connection state UI, and advanced output routing controls
- New tutorial hub module and broader modular project structure for maintainability

### Fixes And Reliability Improvements

- Major sync/output runtime hardening to reduce state drift and improve live output consistency
- Better relay/session resilience with reconnect actions and clearer connection visibility in UI
- Improved state persistence and sanitization for recent/pinned Bible references and host settings
- Better input safety through typing shortcut guards to prevent accidental hotkey triggers while editing fields
- Startup behavior improvements including vMix reconnect-on-start and safer restore flows

---

## Setup (2 Minutes)

1. Open OBS Studio
2. Add `BSP_display.html` as a Browser Source in your scene
3. Add `Bible Song Pro panel.html` as an OBS custom browser dock
4. Open the panel and start controlling your live display

---

## How It Works

- `Bible Song Pro panel.html` -> Control interface
- `BSP_display.html` -> OBS output screen
- Real-time sync via `BroadcastChannel` API

---

## Built for Churches

Bible Song Pro is designed to help churches and ministries present scripture and song lyrics beautifully during live streams without complex software.

---

## Demo

Watch it in action:  
[https://www.youtube.com/watch?v=4SVs5jyYx3o](https://www.youtube.com/watch?v=4SVs5jyYx3o)

---

## Download

Get the latest version here:  
[https://github.com/Johnbatey/bible-song-pro-obs/releases/latest](https://github.com/Johnbatey/bible-song-pro-obs/releases/latest)

<a href="https://github.com/Johnbatey/bible-song-pro-obs/releases/latest">
  <img src="assets/download-button.svg" alt="Download Bible Song Pro" height="132">
</a>

---

## Tech Stack

- HTML, CSS, JavaScript
- `BroadcastChannel` API
- OBS Browser Source

---

## Support

- Instagram: `https://www.instagram.com/johnsonolakotan`
- [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Support-orange?style=for-the-badge)](https://buymeacoffee.com/johnsonolakotan)

---
## Feedback Backend

To let the in-app Feedback form create GitHub issues directly, run the bundled backend:

1. Set environment variables:
   - `GITHUB_TOKEN` = a GitHub token with issue write access
   - `GITHUB_REPO` = `Johnbatey/bible-song-pro-obs` (or another `owner/repo`)
   - Optional: `FEEDBACK_PORT` = backend port, default `8787`
2. Start the server:
   - `npm run feedback:server`
3. Start the app and use the Feedback tab. The public build uses the bundled default feedback endpoint automatically.

Health check:
- `http://127.0.0.1:8787/health`

The backend keeps the GitHub token on the server side and returns the created issue URL to the app.

---

## Feedback Worker

For public deployment without keeping your PC running, use the Cloudflare Worker in [feedback-worker](feedback-worker).

Quick path:

1. `cd feedback-worker`
2. `npm install`
3. `npx wrangler login`
4. `npx wrangler secret put GITHUB_TOKEN`
5. `npm run deploy`
6. If you change the deployed Worker in future, update the default feedback endpoint in the panel source.
   - Current deployed Worker: `https://bible-song-pro-feedback.johnbatey-bsp.workers.dev/api/github-feedback`

The Worker setup is documented in [feedback-worker/README.md](feedback-worker/README.md).

---
## License

GPL-3.0. See [LICENSE](LICENSE) for full terms.
