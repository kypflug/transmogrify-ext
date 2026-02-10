# Transmogrifier

An AI-powered Microsoft Edge extension that "transmogrifies" web pages into beautiful, focused reading experiences. Uses a large language model to generate complete HTML documents with optional AI-generated images.

Supports **multiple AI providers** out of the box — Azure OpenAI, OpenAI, Anthropic (Claude), and Google (Gemini). Bring your own API key.

## Features

- **AI-Powered Transformation**: Generates complete, standalone HTML documents via your preferred LLM
- **Multi-Provider Support**: Azure OpenAI, OpenAI, Anthropic (Claude), or Google (Gemini)
- **BYOK (Bring Your Own Key)**: All API keys configured via the in-extension Settings UI — no build-time secrets
- **Encrypted Key Storage**: AES-256-GCM encryption with PBKDF2 key derivation protects all API keys at rest
- **Settings Sync**: Encrypted settings sync to OneDrive so keys carry across devices
- **AI Image Generation**: Optional image generation via Azure OpenAI, OpenAI, or Google Gemini
- **Built-in Recipes**: Focus, Reader, Aesthetic, Illustrated, Visualize, Declutter, Interview, and Custom modes
- **Pin Favorites**: Pin preferred recipes to the top of the list
- **Library**: Full two-pane article browser with search, filtering, sorting, and inline reading
- **Saved Articles**: IndexedDB storage for unlimited article saving
- **OneDrive Sync**: Sign in with a Microsoft account to sync articles across devices via OneDrive AppData
- **Article Sharing**: Share articles via public URLs (`transmogrifia.app/shared/{code}`) — BYOS (Bring Your Own Storage) with Azure Blob Storage
- **Respin**: Re-transform saved articles with different recipes
- **Parallel Jobs**: Run multiple jobs simultaneously with independent progress tracking
- **Live Library Updates**: Library auto-refreshes when articles are added, deleted, or synced
- **In-Progress Tracking**: Active remixes appear in the Library sidebar with live status
- **Content Script Re-injection**: Automatically re-injects content scripts after extension reload
- **Keyboard Shortcuts**: `j`/`k` to browse articles, `f` to favorite, `Delete` to remove, `/` to search
- **Dark Mode**: All recipes respect `prefers-color-scheme`
- **New Tab View**: Open any article as a clean standalone page
- **Export**: Save articles as standalone HTML files

## Companion PWA

The **Library of Transmogrifia** ([kypflug/transmogrifia-pwa](https://github.com/kypflug/transmogrifia-pwa)) is a standalone Progressive Web App for reading transmogrified articles on any device — phone, tablet, or desktop — without the extension. It shares the same Azure AD app registration, OneDrive `articles/` AppFolder, and `OneDriveArticleMeta` schema, so articles created by the extension appear automatically in the PWA and vice versa for metadata changes (favorites).

## Setup

### Prerequisites
- Node.js 18+
- An API key from **one** of the supported providers:
  - [Azure OpenAI](https://learn.microsoft.com/azure/ai-services/openai/)
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Anthropic (Claude)](https://console.anthropic.com/)
  - [Google (Gemini)](https://aistudio.google.com/apikey)
- (Optional) An image-capable API key (Azure OpenAI, OpenAI, or Google) for AI image generation
- (Optional) Azure app registration for OneDrive sync

### Configuration

All API keys and provider settings are managed through the **Settings UI** built into the extension — no `.env` file or build-time secrets needed.

1. Install the extension (see below)
2. Click the ⚙ gear icon in the extension popup or right-click the extension icon → **Settings**
3. Choose your **AI Provider** (Azure OpenAI, OpenAI, Anthropic, or Google) and enter your API key
4. (Optional) Choose an **Image Provider** for AI-generated illustrations
5. (Optional) Set a **Sync Passphrase** to encrypt settings for OneDrive cross-device sync

> **Note:** Anthropic does not currently offer an image generation API.

Keys are encrypted locally with a per-device key (no passphrase needed). For cross-device sync, a passphrase encrypts settings on OneDrive.

### Build
```bash
npm install
npm run build
```

### Load in Edge
1. Navigate to `edge://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist` folder

## Usage
1. Visit any webpage
2. Click the Transmogrifier extension icon
3. Choose a recipe (Focus, Reader, Illustrated, etc.)
4. (Optional) Toggle "Generate AI Images" for visual enhancements
5. Click **"✨ Transmogrify & Read"** to start the job and open the Library, or **"📥 Send to Library"** to queue it silently
6. The popup dismisses immediately; the AI generates the article in the background
7. Articles are automatically saved and browsable in the Library

### Library
Click "Library" in the popup to open the full Library view. The Library provides:
- Two-pane layout: article list on the left, reader on the right
- Search, filter by recipe/favorites, and sort (newest, oldest, A-Z)
- Inline article reading in a sandboxed iframe
- Action bar: Favorite, Save, Original link, New Tab view, Respin, Delete
- Resizable sidebar with drag handle
- Keyboard shortcuts: `j`/`k` or `↑`/`↓` to browse and open articles, `f` to favorite, `Delete` to remove, `/` to search
- Floating shortcut legend in the bottom-right corner
- In-progress remixes shown at the top of the sidebar with live status and cancel button
- Sync status bar with sign-in and manual sync
- Share articles: Share button creates a public URL; manage existing links with copy/unshare

### Parallel Jobs
You can start multiple jobs on different tabs simultaneously. Active jobs appear in the popup and the Library sidebar with live progress and cancel buttons.

### Respin
Open a saved article and click "Respin" to re-transform it with a different recipe without re-extracting from the original page.

### OneDrive Sync
Sign in via the Library's sync bar to enable cross-device article sync through OneDrive. Articles are pushed to the cloud on save/delete/favorite and pulled periodically (every 5 minutes) or on demand.

## Recipes

| Recipe | Description |
|--------|-------------|
| Focus Mode | Strips distractions and centers content in a calm, book-like layout |
| Reader Mode | Editorial magazine layout with drop caps, pull quotes, and refined type |
| Aesthetic | Bold, artistic redesign with dramatic layouts and color |
| Illustrated | Adds AI-generated photos and illustrations in a warm editorial style |
| Visualize | Turns concepts into annotated diagrams and data-rich layouts |
| Declutter | Ultra-lightweight brutalist page with minimal CSS |
| Interview | Reformats Q&A and interviews as a messaging chat with speech bubbles |
| Custom | Write your own prompt for full creative control |

All recipes include:
- Dark mode support (`prefers-color-scheme`)
- Readable typography (65-75ch line width, 1.6-1.8 line-height)
- Generous whitespace and breathing room
- 4.5:1 minimum contrast ratio

## Project Structure
```
src/
+-- content/              # Content scripts
|   +-- content-extractor.ts  # Semantic content extraction
|   +-- index.ts              # Message handling
+-- popup/                # Extension popup (recipe picker + library link)
+-- library/              # Full-page article browser
|   +-- library.html
|   +-- library.css
|   +-- library.ts
+-- settings/             # Settings UI (API keys, providers, encryption)
|   +-- settings.html
|   +-- settings.css
|   +-- settings.ts
+-- viewer/               # Article viewer page
+-- background/           # Service worker (orchestration)
+-- shared/               # Types, recipes, services
    +-- ai-service.ts         # Multi-provider AI API (Azure OpenAI / OpenAI / Anthropic / Google)
    +-- image-service.ts      # Image generation API (Azure OpenAI / OpenAI / Google Gemini)
    +-- config.ts             # Provider types & runtime config resolution from Settings
    +-- crypto-service.ts     # AES-256-GCM encryption (device key + passphrase modes)
    +-- device-key.ts         # Per-device non-extractable CryptoKey (IndexedDB)
    +-- settings-service.ts   # Settings CRUD, sync passphrase, encrypted sync
    +-- blob-storage-service.ts # BYOS blob upload + short link registration
    +-- cloud-queue-service.ts # Cloud function queue client (BYOK)
    +-- storage-service.ts    # IndexedDB article storage
    +-- auth-service.ts       # Microsoft OAuth2 PKCE
    +-- onedrive-service.ts   # OneDrive Graph API client
    +-- sync-service.ts       # Bidirectional sync orchestrator
    +-- recipes.ts            # Recipe definitions
```

## Documentation
- [claude.md](./claude.md) - AI development guide
- [CHANGELOG.md](./CHANGELOG.md) - Version history

## License
MIT
