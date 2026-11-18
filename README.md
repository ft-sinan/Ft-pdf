# Ft PDF

An Android-ready document studio with an actual SQLite backend, private accounts, and editors that save and download real files. The first visit opens an isolated demo workspace with 12 documents, three collections, starred previews, and recent activity. No demo password or external service is needed.

## Run the workspace

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

## Android

### Install the client

Download the **ft-pdf-debug-apk** artifact from a successful **Android debug APK** run in GitHub Actions. Extract the ZIP and install `ft-pdf-debug.apk` (Android 8.0+). The workspace sidebar also links to the downloadable APK.

**Create a PDF without hosting:** launch Ft PDF → **Create PDF** → enter a document title, choose A4 or US Letter, and write/paste text → **Save PDF…**. Choose the destination in Android Files. Text wraps and paginates on-device; leaving the body empty creates a single blank page. You can open the saved file in a PDF reader. No account, internet connection, or workspace URL is required for this flow. Cancelling the picker keeps your draft.

**Optional online workspace:** connect a reachable Ft PDF server to use the account, shared library, and document editors. The APK does not embed the Node server. With a configured server it supports the system file picker, **Open with Ft PDF**, sharing documents into the workspace, and **Save as**. Incoming uploads require confirmation. No unrestricted storage access or JavaScript-to-native bridge is needed.

### Build from source

Open `android/` in Android Studio with JDK 17 and Android SDK 35, or run:

```sh
cd android
./gradlew :app:assembleDebug
# Optional: preconfigure the initial workspace address
./gradlew :app:assembleDebug -PftWorkspaceUrl=https://your-ft-pdf-server.example
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. The debug variant also accepts HTTP for local development. From the Android emulator, use `http://10.0.2.2:5173` to reach the host's development server. **Do not use localhost on a physical phone**; use a reachable HTTPS deployment. Release builds require HTTPS. Use your own release-signing process for distribution; no signing credentials are stored in this repository.

The `Android debug APK` workflow builds with JDK 17 and SDK 35 on Android source changes. It runs unit tests, verifies the APK signature with `apksigner`, and publishes the APK and `SHA256SUMS.txt` in the run’s artifacts for 30 days. A separate emulator job creates and renders blank A4 and multipage Unicode Letter PDFs. No signing secrets are required. Debug signatures may differ between builds: if Android rejects an update because of a signature conflict, save any work before uninstalling the previous debug build. Files exported via Android Files are separate from app-private settings.

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

- **Account isolation:** first visit creates a private demo. **Profile → Create account** claims that workspace, including any edits. Signing into an existing account switches workspaces. Signing out opens a new demo, never another account’s data.
- **Document lifecycle:** create, multi-file import, open, edit, rename, star, move, download, trash, undo, restore, and permanent deletion. Deleting a collection keeps its documents.
- **Navigation:** responsive sidebar/drawer, searchable document picker (`Ctrl/Cmd K`), recent files, starred cards, collections, file type filters, sort, grid/list views, and activity history.
- **Preferences:** Terracotta, Espresso, Forest, and Midnight palettes, plus editable display names. Themes persist per account.
- **Feedback:** loading and empty states, optimistic document and theme changes with rollback, save conflicts detected across tabs, guarded unsaved edits, and explicit destructive confirmations. `Ctrl/Cmd S` saves an open editor.
- **Storage:** 25 MiB per file and 100 MiB per workspace, including Trash. Storage usage reflects actual stored file bytes. Empty Trash by permanently deleting its contents individually.

## Implementation

- `src/`: React, TypeScript, Vite, local DM Sans fonts, Lucide icons, and original vector artwork. Heavy PDF editing libraries load on demand.
- `server/`: Express API, SQLite via `node:sqlite`, per-user authorization, session rotation, scrypt password hashing, HTTP-only cookies, validated uploads, and real format conversion.
- `android/`: native Java Android host with document intents, authenticated imports/downloads, and a configurable workspace origin.
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
