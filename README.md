# Blackbar

Blackbar helps people who receive official letters in the United States (USCIS notices, landlord notices, university bills, insurance and bank letters) understand them without pasting their Social Security number, A-number, SEVIS ID, name or address into a chatbot. It is built for international students and immigrants. The letter is read and redacted in the browser by Chrome's built-in model, and only the redacted text can go to Gemini for a longer explanation, a checklist or a draft reply.

**Try it:** https://blackbar-8cba0.web.app (the on-device features need desktop Chrome; see Requirements).

![How Blackbar handles a letter: sealing and the summary run on the device, a leak gate checks every request, Gemini receives sealed text only, and real details are put back on the device.](docs/architecture.svg)

## Model calls

Every call goes through the Firebase AI Logic SDK (`firebase/ai`). There is one model instance per feature, each with a fixed inference mode.

| Feature | Inference mode | Runs on | Why this side |
|---|---|---|---|
| Find identifiers (names, case and reference numbers) | `ONLY_ON_DEVICE`, JSON output through `onDeviceParams.promptOptions.responseConstraint` | Chrome built-in model | It reads the unredacted letter, so it must never fall back to the cloud. |
| At a glance (document type, sender, deadlines, amounts, what is asked) | `ONLY_ON_DEVICE`, JSON output | Chrome built-in model | Same reason. It also works offline. |
| Read a photo or scan | `ONLY_ON_DEVICE`, PNG or JPEG input | Chrome built-in model | The image contains every identifier. |
| Explain on this device | `ONLY_ON_DEVICE`, streamed | Chrome built-in model | Offered when the device is offline or a cloud request fails. It may read the full letter because nothing leaves the device. |
| Explain it plainly, What should I do next?, Draft a reply, follow-up questions | `ONLY_IN_CLOUD`, streamed, `gemini-3.5-flash-lite` | Gemini through Firebase AI Logic, with App Check | Longer answers in ten languages. It receives sealed text only, after the leak gate. |
| Model download and warm-up | `initializeDeviceModel()` on a click | Chrome | Chrome requires a user gesture to start the download. |

Each response's `inferenceSource` is shown in the privacy receipt. On-device results whose `inferenceSource` is not `on_device` are discarded.

## Privacy model

- **Sealing.** Pattern checks (`src/seal/detectors.ts`) find structured identifiers: SSNs, A-numbers, SEVIS IDs, USCIS receipt numbers, labelled passport, account, case, student and member numbers, phone numbers, email addresses, street addresses, ZIP codes, labelled dates of birth, and names after "Dear" or a label such as "Beneficiary:". The on-device model adds what patterns miss. A value the model returns is used only if it appears in the letter exactly as written. Dates other than a labelled date of birth are never barred, so deadlines stay readable.
- **Placeholders.** Each hidden value becomes a placeholder such as `⟦NAME_1⟧`. The same value always gets the same placeholder, and every place it appears is barred. The table from placeholder to value stays in the tab's memory.
- **What is sent.** The "What leaves this device" panel shows the exact sealed text before anything is sent. Follow-up questions are sealed the same way, and the panel shows the question as it will be sent. Nothing is sent while the on-device model is still looking for names.
- **Leak gate.** Before every cloud request, `leakCheck` (`src/seal/redact.ts`) searches the whole payload (instructions, letter, question and earlier answer) for every hidden value. It ignores letter case and finds copies with the spacing or punctuation removed. If it finds one, the request is not made and the reader sees which detail it was.
- **Restoring.** Answers arrive with placeholders. "Show my details" puts the real values back in the browser.
- **Storage.** There are no accounts, no analytics and no server of our own. The letter lives in the tab's memory until the tab is closed or "Forget this letter" is pressed. The only thing written to the browser is the light or dark setting. The service worker caches the app's own files, never letter text.

**Limits.**
- The leak gate only knows values that have a bar. If both the patterns and the model miss an identifier, and the reader does not black it out, it is sent. This is why the reader reviews the bars before sending.
- Values shorter than six characters are matched exactly, so a reformatted short value is not caught.
- Gemini sees everything that is not barred: the sender, dates, amounts and the wording of the letter.
- Requests to Firebase carry the usual network metadata (IP address, App Check token).
- Model readings of photos can drop or change characters. The transcription is shown for correction before sealing.

## What is verified

`npm run e2e` runs headless Chrome with the real on-device model and writes [docs/e2e-results.json](docs/e2e-results.json) and [docs/screens/](docs/screens/). It checks:

- every listed identifier in each sample letter is barred, including one name that only the model can find;
- the deadline is correct and readable;
- every on-device call reports `on_device`, and no request leaves 127.0.0.1;
- the same checks after a reload with the network cut, with the app loaded by the service worker;
- a rendered image of a letter is transcribed and sealed on the device;
- real Gemini requests for each sample report `in_cloud`, and no request body contains an identifier;
- a follow-up containing a reformatted hidden value is blocked with no request made;
- selecting text and blacking it out bars every occurrence and updates the sealed text and the counts;
- keyboard-only use of the bars: Tab, Enter, Space, Peek, Keep visible, Black it out again, Escape, and focus returning to the bar;
- the download states (not downloaded, downloading NN%, ready), shown through a development-only test double;
- an axe-core accessibility scan of each state in light and dark;
- the "What leaves this device" panel stays in view beside long answers at desktop width.

`npm test` runs the unit tests: detectors, sealing, leak gate, question sealing, model-string mapping, deadlines, calendar files, chunking, prompts and the session state.

**Not verified:**
- a first-time model download in Chrome (the model was already installed, so the download states use a test double);
- the reCAPTCHA Enterprise App Check provider used by the hosted build;
- Windows, Linux and ChromeOS;
- photos of real paper letters (only a rendered image was tested);
- screen readers other than through axe-core and the keyboard checks;
- answer quality in languages other than English and Spanish;
- letters long enough to be split into parts with the real model (the splitting is unit-tested).

## Requirements

On-device features need desktop Chrome 139 or later with Chrome's built-in model. That means Windows 10 or 11, macOS 13 or later, Linux, or a Chromebook Plus, with about 22 GB of free disk space and either a GPU with more than 4 GB of memory or 16 GB of RAM and four CPU cores. The first download is about 2.5 GB.

Without the on-device model, Blackbar still works with pattern checks only. The page says so, names are not found automatically, and the reader can black out anything by hand. Photos cannot be read, and there is no "At a glance" summary.

## Setup and run

```bash
cp .env.example .env.local   # fill in the Firebase web app config
npm install
npm run dev                  # http://127.0.0.1:5183
npm test
npm run lint
npm run build                # dist/, with the service worker
npm run e2e                  # headless Chrome; see scripts/e2e.mjs
```

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_*` | Firebase web app config. |
| `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | App Check provider for the hosted build. |
| `VITE_APPCHECK_DEBUG_TOKEN` | Development only. An App Check debug token registered in the Firebase console, for cloud calls from 127.0.0.1. Production builds replace it with an empty string. |
| `VITE_APPCHECK_DEBUG` | Development only. `true` makes the SDK print a new debug token to register. |
| `VITE_MOCK_CLOUD` | Development only. `true` replaces cloud answers with a stand-in labelled "Mock cloud response". Not included in production builds. |

Keep `.env.local` and debug tokens out of version control. `.gitignore` already excludes `.env.local`.

`npm run e2e` expects a Chrome profile that already has the model. It clones `../lab/.chrome-profile` into `.e2e-profile` using a copy-on-write clone.

Hosting configuration is in `firebase.json` (serves `dist/`, with no caching for `index.html` and `sw.js` and long caching for hashed assets) and `.firebaserc`.

## Project layout

- `src/seal/`: detectors, sealing and placeholders, leak check, question sealing, counts.
- `src/ai/`: Firebase and App Check setup, on-device calls (`device.ts`), cloud calls and the leak gate (`cloud.ts`, `cloudSender.ts`), prompts, glance validation.
- `src/lib/`: dates and deadlines, calendar (`.ics`) files, chunking for the 9,216-token on-device limit, transcription fixes, a small Markdown reader.
- `src/state/`: session state and hooks.
- `src/components/`: the three stages and the privacy receipt.
- `scripts/`: the service worker build plugin, the headless Chrome launcher and the e2e run.
- `docs/`: diagram, screenshots and e2e results.

## Built during the hackathon

All code in this repository was written from 2026-11-18 onward, during the #BuildHybridAI submission period. There is no code from before that date apart from the open-source dependencies listed in `package.json`. AI coding assistants were used during development.

## Not legal advice

Blackbar explains letters. It does not give legal advice, and its answers can be wrong. For questions about immigration status, ask your school's international student office or a qualified immigration attorney.

## License

Apache License 2.0. See [LICENSE](LICENSE).
