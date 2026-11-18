# Ft PDF

An offline Android document studio and a separate server-backed web edition. New libraries start empty. Documents you already have are kept when upgrading with the same signing key.

## Getting started (3.2)

- **Open a PDF from Files:** choose **Open with → Ft PDF**. That PDF opens directly in reading mode, even on the very first launch. There is no import, account, setup, or storage permission prompt. A protected PDF still needs its own password. Back returns to the previous activity; an open workspace draft is left alone.
- Viewing an external PDF doesn’t add it to the library or change the original. **Edit** is optional; saving an edit makes a separate library copy. To keep an unedited copy, use **Import files** in the workspace.
- **Open the app icon:** the first regular launch offers a welcome card and a short, skippable tour. Scroll, star or edit the practice note; none of it becomes a real document or activity entry. Then enter your display name and, optionally, date of birth. The birth date stays on this Android device (or in this browser in the web edition). Change or clear it, or replay the tour, in **Settings → Account**. Later launches open your library.

## Reading and Creator Space

- Open a library document, search result, phone working copy or single import to **read first**. New documents and library outputs open the same way. PDFs scroll continuously through real pages; nearby pages render on demand. Word and text are selectable, read-only pages; HTML opens as a script-disabled preview. Tap **Edit** to reveal the tools. The editor’s back arrow returns to reading; unsaved changes require a decision. Password-protected PDFs stay read-only.
- The reader’s **Delete** (trash can) names the file and asks before moving the library copy to **Trash**. Use **Undo** or restore it from Trash. Only Trash offers permanent deletion. The file in Android Files is never deleted by this action.
- Open **Settings → Creator Space** for Sinan’s signature card, inspired by [My Vault](https://github.com/ft-sinan/My-vault-android). Flip the seal, tap a badge, or open/copy a contact. The card is bundled offline. On Android, tapping a contact hands only its public link to an external app, never the document.

## Android app

**Install:** Download [**ft-pdf-debug.apk**](public/downloads/ft-pdf-debug.apk) or extract the `ft-pdf-debug-apk` artifact from a successful **Android debug APK** Actions run. Use Android 8.0+ with an updated Android System WebView (Chromium 105+). **No workspace address, network permission, subscription or server is required.**

- **Documents on this phone:** On Home, **Scan my phone** asks for Android’s optional all-files access (storage permission on Android 8–10). Or tap **Choose folder** to grant read access only to a directory you select. Neither is required to use the private library. Browse/search PDF, DOC/DOCX, TXT and HTML in shared storage, refresh after external changes, or disconnect a source under **Manage phone sources**. Other apps’ private directories are not scanned. Scans are bounded; use a narrower folder if the partial-results notice appears. Opening a phone file creates a private working copy; reopening the same unchanged source reuses your edits. If the source bytes change, it opens as a new copy.
- **Photos to PDF:** Use **Images to PDF** on Home or **New document → PDF → Create from images**. Select one or more JPG, PNG or WebP files, or take a photo with the phone’s camera app. Reorder, rotate or remove individual images, choose paper and margins, then save a real multipage PDF. Up to 32 images, downsampled to a maximum 2,000-pixel long edge; originals are never modified.
- **Create a blank or text PDF:** Tap **New document → PDF**, give it a name, choose A4 or US Letter, and optionally add text. **Create PDF** saves it to your library and opens the reader. Text wraps across pages; an empty body gives one blank page. Tap **Edit** to annotate it or organize its pages.
- **Import into the library:** **Import files → Choose files** and **Share → Ft PDF** intentionally ask you to confirm the import. A single imported file opens in the reader; a batch opens the destination library. Non-PDF **Open with** also uses import. These are separate from the direct PDF reader.
- **Keep a copy outside the app:** Use the reader’s or editor’s download-arrow button (**Save a copy to Files**) and pick a destination. This exports the actual PDF, DOCX, TXT or HTML file. Export important work before clearing app data or uninstalling, including before replacing a previous debug build if Android reports a signing conflict.
- **Accounts and collections:** Use the navigation drawer to create collections, see all files, change theme, or create/sign in to a local profile. Registering claims the current guest library. Sign-out switches to a separate guest library; signing back in restores your files. Profiles do **not** sync to a cloud account or another device.

### Offline PDF toolbox

Home → **PDF toolbox** works on library documents or files selected in Android Files. Everything runs on the phone, including the bundled English OCR engine. Results never overwrite inputs. PDF and DOCX outputs go to the library; JPG, ZIP, XLSX and PPTX outputs use Android’s save dialog.

| Task | What the Android app does |
| --- | --- |
| Organize | Merge in chosen file order; split by ranges to ZIP; extract/reorder, remove, rotate and crop pages. Cropping only hides margins. |
| Optimize and review | Lossless structural rewrite or lossy image compression (only save smaller results); best-effort repair of readable PDFs; flatten; highlight visual differences between two PDFs. |
| Convert | Images or local HTML/TXT to PDF; PDF pages to JPG or image slides in PPTX; PDF text to DOCX or worksheet cells in XLSX; DOC/DOCX text, XLSX values and PPTX slide text to paginated PDF. |
| OCR | Rasterize selected pages and add a searchable English text layer. Review recognition accuracy, particularly on handwriting and low-resolution scans. No language download needed. |
| Mark up and protect | Watermark, page numbers, hand-drawn signature, AES-256 opening password, authorized password removal. Redaction burns marked rectangles into a **new rasterized copy** and discards all original text and attachments. Review the copy before sharing. |

This is an independent offline toolset, **not** full iLovePDF parity. Office imports reflow text/values, rather than preserving complex formatting, formulas, charts or animations. PDF-to-Word/Excel require selectable text (use OCR for scans); PowerPoint output is page images, not editable slide objects. A drawn signature is visual, not certificate signing. No certified PDF/A conversion, translation, remote signing, cloud collaboration or website-URL rendering. Raster tools lose links, forms and vectors. The app limits private files to 25 MiB and a library to 100 MiB; expensive operations also cap pages or output size. Unlock requires an authorized password, and reconstruction cannot recover arbitrary corrupt files.

### Android build and verification

With Node 22.13+, JDK 17 and Android SDK 35 installed:

```sh
npm ci
cd android
./gradlew :app:assembleDebug
```

The normal Gradle build includes the full editor UI, Word converter, PDF.js worker, fonts, CMaps, and local OCR worker/WASM/English model. Test documents are not shipped. Output: `android/app/build/outputs/apk/debug/app-debug.apk`. App data uses private SQLite metadata and private document files. There is no Node runtime or loopback server inside the APK. The native message channel accepts only the bundled app origin and main frame; imported HTML previews have an opaque, script-disabled sandbox. Passwords use a salted PBKDF2 hash. As with other debug apps, do not rely on debug signing or local profiles as a defense against someone with privileged access to the device.

The GitHub Actions workflow assembles and signs the debug APK, checks its assets, permissions and signature, and installs **that exact artifact** on an Android 15 emulator with airplane mode enabled. Instrumentation exercises cold and warm PDF opens (including first use, activity recreation, a protected PDF and a pending studio edit), welcome/tour/empty-library setup, profile persistence across process death, account isolation, collections, the editors, genuine legacy Word input, the Android Files picker, exports, and PDF rendering. Reader checks cover continuous scrolling, explicit editing, library-only trash/restore, and the offline creator card with an external contact handoff. Toolbox checks cover shared-storage and folder access, private-copy reuse, reordered photo pages, toolbox merging, a split-ZIP export and searchable OCR output. `npm run build:device && node tests/device-tools.mjs` checks the production tool chunks in Chromium (install Playwright Chromium first). A trusted push marked `[publish-debug-apk]` publishes the tested APK and SHA-256 checksum on the same branch only after both jobs pass. No signing keys are stored in Git.

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

Use a persistent volume, not an ephemeral deployment filesystem. Back up SQLite using its backup facility or a consistent snapshot including the WAL. `/api/health` is a lightweight health check that does not create a guest library.

### Install without an APK

Open the HTTPS workspace in Android Chrome and use **Install app** or **Add to Home screen**. The PWA includes install icons, shortcuts, file handlers where the browser supports them, and an Android share target. Its PDF file handler also reads the selected file directly without uploading it; saving an edit explicitly creates a workspace copy. The service worker caches public assets only for normal browsing; shared files are temporarily staged until handed to the import dialog. Private documents and session responses are not cached for offline browsing. Reading and saving workspace documents require connectivity.

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

- **Account isolation:** first visit creates an empty guest workspace. **Profile → Create account** claims that workspace, including any edits. Signing into an existing account switches workspaces. Signing out opens a separate guest workspace, never another account’s data.
- **Document lifecycle:** create, multi-file import, open, edit, rename, star, move, download, trash, undo, restore, and permanent deletion. Deleting a collection keeps its documents.
- **Navigation:** responsive sidebar/drawer, searchable document picker (`Ctrl/Cmd K`), recent files, starred cards, collections, file type filters, sort, grid/list views, and activity history.
- **Preferences:** Terracotta, Espresso, Forest, and Midnight palettes, plus editable display names. Themes persist per account.
- **Feedback:** loading and empty states, acknowledged document changes and optimistic theme updates with rollback, save conflicts detected across tabs, guarded unsaved edits, and explicit destructive confirmations. `Ctrl/Cmd S` saves an open editor.
- **Storage:** 25 MiB per file and 100 MiB per workspace, including Trash. Storage usage reflects actual stored file bytes. Empty Trash by permanently deleting its contents individually.

## Implementation

- `src/`: React, TypeScript, Vite, local DM Sans fonts, Lucide icons, and original vector artwork. Heavy PDF editing libraries load on demand.
- `server/`: Express API, SQLite via `node:sqlite`, per-user authorization, session rotation, scrypt password hashing, HTTP-only cookies, validated uploads, and real format conversion.
- `android/`: Android SQLite library, scoped message bridge, native PDF creation, file intents, and system-picker integration.
- `src/device/`, `scripts/build-device.mjs`, `shared/`: on-device editor adapter, bundled format workers, offline asset packaging and shared Word writer.
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
