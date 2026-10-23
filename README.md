# life.operatingsystem

**You decide. Your agents do the rest.**

A personal operating system: an AI chief of staff that you talk to by voice, text or Telegram. It plans your day,
remembers what matters to you, helps you study with spaced repetition, and asks before anything that matters.
It runs on your own computer, with your own Claude account. Your notes stay in your own folder.

## Download

Get the installer for your computer from **[Releases](https://github.com/kemet333/life-operatingsystem/releases/latest)**:

- **macOS** (Apple silicon): `life.operatingsystem-…-Mac.dmg`. The app is not notarized yet: the first time, right-click it
  in Applications → **Open**, or allow it in System Settings → Privacy & Security.
- **Windows** (x64): `life.operatingsystem-…-Windows.exe`. Windows SmartScreen may warn about an unknown publisher:
  **More info → Run anyway**.

On first launch it asks your name, opens the Claude sign-in in your browser and, if you want, your notes folder and the
code projects for the agent team.

You need a **Claude account (Pro or Max)**. Optional: **Python 3** for the agent team, an **ElevenLabs** key for the natural
voice (otherwise the system voice), a **Telegram** bot of your own, and **whisper.cpp** to dictate by voice.

Everything in one app:

- **Your chief of staff**: voice and text, and the same assistant on Telegram.
- **A team of AI agents**: six departments that plan your projects every morning, build in their own branch,
  review each other and wait for your yes. One task per agent, a receipt for every change.
- **Your day**: a short to-do every morning, a day and week close, spaced-repetition review.
- **Your memory**: your own notes folder (Obsidian works) as long-term memory.
- **Content**: a calendar of what goes out, with previews, and the trends that work in your niche.

## Build it yourself

```sh
cd alfred-os && npm ci && cd ../mac/local-workspace && npm ci && cd ../../escritorio && npm install
node preparar.mjs && npx electron-builder --mac   # or --win
```

Tests: `python -m unittest discover -s equipo` and the `*-checks.mjs` in `mac/local-workspace`. The folders:
`alfred-os` (interface), `mac/local-workspace` (local server), `equipo` (agent team engine), `escritorio` (desktop app),
`mac` (native macOS app, optional).

## Principles

- **You hold the keys.** Nothing is published, sent, spent or traded without your explicit yes.
- **Local first.** It runs on your machine. No servers of ours in between.
- **No invented progress.** Dates, evidence and limits. If something isn't verified, it says so.

## License

[GNU Affero General Public License v3.0](LICENSE). You can use, study, change and share it; if you run a modified
version as a service for others, you must publish your changes under the same license.
