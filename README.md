# Ft PDF

An offline Android document studio and a separate server-backed web edition. Both open to a working library with 12 example files, three collections, starred documents and a recent activity view.

## Android app

**Install:** Download [**ft-pdf-debug.apk**](public/downloads/ft-pdf-debug.apk) or extract the `ft-pdf-debug-apk` artifact from a successful **Android debug APK** Actions run. Use Android 8.0+ with an updated Android System WebView (Chromium 105+). Open **Ft PDF**: the dashboard is the first screen. **No workspace address, network permission, subscription or server is required.**

- **Create PDF:** Tap **New document → PDF**, give it a name, choose A4 or US Letter, and optionally add text. **Create PDF** saves it to your library and opens the editor. Text wraps across pages; an empty body gives one blank page. You can annotate it or organize its pages immediately.
- **Open your files:** Tap **Import files → Choose files**, or use Android’s **Open with / Share → Ft PDF**. Confirm the import. A single file opens in its editor. Saving changes updates your private copy, not the original in Files.
- **Keep a copy outside the app:** Use the editor’s download-arrow button (**Save a copy to Files**) and pick a destination. This exports the actual PDF, DOCX, TXT or HTML file. Export important work before clearing app data or uninstalling, including before replacing a previous debug build if Android reports a signing conflict.
- **Accounts and collections:** Use the navigation drawer to create collections, see all files, change theme, or create/sign in to a local profile. Registering claims the current guest library. Sign-out switches to a separate guest library; signing back in restores your files. Profiles do **not** sync to a cloud account or another device.

### Android build and verification

With Node 22.13+, JDK 17 and Android SDK 35 installed:

```sh
npm ci
cd android
./gradlew :app:assembleDebug
```

The normal Gradle build includes the full editor UI, Word converter, PDF.js worker, fonts, CMaps and example documents. Output: `android/app/build/outputs/apk/debug/app-debug.apk`. App data uses private SQLite metadata and private document files. There is no Node runtime or loopback server inside the APK. The native message channel accepts only the bundled app origin and main frame; imported HTML previews have an opaque, script-disabled sandbox. Passwords use a salted PBKDF2 hash. As with other debug apps, do not rely on debug signing or local profiles as a defense against someone with privileged access to the device.

The GitHub Actions workflow assembles and signs the debug APK, checks its assets, permissions and signature, and installs **that exact artifact** on an Android 15 emulator with airplane mode enabled. Instrumentation exercises first launch, profile persistence across process death, account isolation, collections, the editors, genuine legacy Word input, the Android Files picker, exports, and PDF rendering. A trusted push marked `[publish-debug-apk]` publishes the tested APK and SHA-256 checksum on the same branch only after both jobs pass. No signing keys are stored in Git.

## Run the separate web workspace

Use **Node.js 22.13 or newer** (Node 22 LTS recommended).

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Express serves Vite and the API from the **same origin**; there is no separate frontend API URL to configure. The server binds to `0.0.0.0`. The first run creates `data/ft-pdf.sqlite` automatically. Files, metadata, collections, themes, accounts, and sessions survive server restarts.

For production:

```sh
npm run build
PORT=8080 npm start
```

Serve the app behind HTTPS. Set `FT_DB` to a writable persistent database path. When TLS terminates at a reverse proxy, forward the original host and protocol and set `FT_SECURE_COOKIE=1`. The unprivileged Docker image is another option:

```sh
docker build -t ft-pdf .
docker run --rm -p 8080:8080 -v ft-pdf-data:/app/data ft-pdf
```

Use a persistent volume, not an ephemeral deployment filesystem. Back up SQLite using its backup facility or a consistent snapshot including the WAL. `/api/health` is a lightweight health check that does not create a demo account.

### Install without an APK

Open the HTTPS workspace in Android Chrome and use **Install app** or **Add to Home screen**. The PWA includes install icons, shortcuts, file handlers where the browser supports them, and an Android share target. The service worker caches public assets only for normal browsing; shared files are temporarily staged until handed to the import dialog. Private documents and session responses are not cached for offline browsing. Reading and saving workspace documents require connectivity.

## Editing support

| Format         | What you can do                                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PDF**        | Render actual pages, zoom, place text, draw, highlight, and undo/redo pending annotations. **PDF tools** can insert/remove/reorder/rotate pages and edit standard text, checkbox, radio, and choice fields. Saving embeds changes into a valid downloadable PDF. |
| **DOCX**       | Import and edit rich text, headings, lists, bold/italic/underline, tables, and common embedded images. Export a real Word file.                                                                                                                                  |
| **DOC**        | Import readable legacy binary Word documents. Text is converted to editable DOCX; the source file on the device is unchanged.                                                                                                                                    |
| **TXT**        | Edit plain text with word count and UTF-8 export. UTF-16 files with a byte-order mark are recognized on import.                                                                                                                                                  |
| **HTML / HTM** | Edit source, view a script-disabled sandboxed preview, and export HTML. Uploaded HTML is served only as an attachment, not as executable same-origin content.                                                                                                    |

PDF editing is annotation, form, and page editing—not OCR, secure redaction, or reflow of arbitrary existing text. Password-protected PDFs require the password to view and are read-only. Changes to a signed PDF can invalidate its previous signature. Unsupported, corrupt, or oversized files show an error. Word exports normalize layout; advanced Office features such as macros, tracked changes, and exact pagination are not reproduced. Download the original first if exact fidelity is important. Unedited imported PDFs and DOCX files retain their original bytes.

## Workspace features

- **Account isolation:** first visit creates a private demo. **Profile → Create account** claims that workspace, including any edits. Signing into an existing account switches workspaces. Signing out opens a separate guest workspace, never another account’s data.
- **Document lifecycle:** create, multi-file import, open, edit, rename, star, move, download, trash, undo, restore, and permanent deletion. Deleting a collection keeps its documents.
- **Navigation:** responsive sidebar/drawer, searchable document picker (`Ctrl/Cmd K`), recent files, starred cards, collections, file type filters, sort, grid/list views, and activity history.
- **Preferences:** Terracotta, Espresso, Forest, and Midnight palettes, plus editable display names. Themes persist per account.
- **Feedback:** loading and empty states, optimistic document and theme changes with rollback, save conflicts detected across tabs, guarded unsaved edits, and explicit destructive confirmations. `Ctrl/Cmd S` saves an open editor.
- **Storage:** 25 MiB per file and 100 MiB per workspace, including Trash. Storage usage reflects actual stored file bytes. Empty Trash by permanently deleting its contents individually.

## Implementation

- `src/`: React, TypeScript, Vite, local DM Sans fonts, Lucide icons, and original vector artwork. Heavy PDF editing libraries load on demand.
- `server/`: Express API, SQLite via `node:sqlite`, per-user authorization, session rotation, scrypt password hashing, HTTP-only cookies, validated uploads, and real format conversion.
- `android/`: Android SQLite library, scoped message bridge, native PDF creation, file intents, and system-picker integration.
- `src/device/`, `scripts/build-device.mjs`, `shared/`: on-device editor adapter, bundled format workers, real demo asset generation and shared Word writer.
- `public/`: PWA, icons, annotation font/license, and the Android client download.
- `tests/`: API, persistence, file interoperability, and browser interaction tests. Tests use isolated in-memory or temporary databases.

## Verification

```sh
npm test                         # backend, isolation, restart persistence, format round trips
npm run build                    # TypeScript checks and production bundle
npx playwright install chromium
npm run test:ui                  # desktop + phone-sized browser workflows
```

`FT_CHROMIUM` can point the browser suite to an existing Chromium executable. The UI suite starts its own temporary server on port 4174. Android packaging is checked separately in CI; desktop/mobile viewport tests are not a substitute for testing on the intended Android device.
