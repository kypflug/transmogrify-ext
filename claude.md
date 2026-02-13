# Transmogrifier - AI Development Guide

## Project Context
Transmogrifier is a Microsoft Edge extension (Manifest V3) that transforms web pages into beautiful, focused reading experiences using **AI-powered HTML generation**. It extracts semantic content from pages and sends it to a configurable AI provider (Azure OpenAI, OpenAI, Anthropic Claude, or Google Gemini) to generate complete, standalone HTML documents.

**Key Features**:
- Complete HTML generation (not DOM mutation)
- BYOK (Bring Your Own Key) — all API keys configured via in-extension Settings UI
- AES-256-GCM encrypted key storage with HKDF identity-derived keys for sync
- Encrypted settings sync to OneDrive for cross-device key portability
- IndexedDB storage for saved articles
- Full Library page for browsing, reading, and managing articles
- OneDrive sync for cross-device article sharing
- Parallel Transmogrify support with independent progress tracking
- Live Library updates and in-progress remix display
- Content script re-injection after extension reload
- Keyboard shortcuts for article skimming
- Optional AI image generation via Azure OpenAI, OpenAI, or Google Gemini
- Article sharing via public URLs (BYOS — Bring Your Own Storage)
- Dark mode support (`prefers-color-scheme`)

## Architecture Overview

### Multi-Repo Architecture

The Transmogrifier ecosystem spans two repos plus a shared infrastructure monorepo:

| Repo | Purpose |
|------|---------|  
| **transmogrify-ext** (this repo) | Edge extension — content extraction, local AI processing, storage, sync |
| [kypflug/transmogrifia-pwa](https://github.com/kypflug/transmogrifia-pwa) | Read-only PWA for browsing articles on any device |
| [kypflug/transmogrifier-infra](https://github.com/kypflug/transmogrifier-infra) | Monorepo — `packages/core` (shared npm package) + `packages/api` (Azure Functions backend) |

**`@kypflug/transmogrifier-core`** is the single source of truth for:
- **Recipes**: All 6 built-in recipe definitions, prompt builder, response format constants
- **AI provider calls**: `callAzureOpenAI`, `callOpenAI`, `callAnthropic`, `callGoogle`, `parseAIResponse`
- **Image provider calls**: `generateAzureImage`, `generateOpenAIImage`, `generateGoogleImage`, `replaceImagePlaceholders`
- **Shared types**: `OneDriveArticleMeta`, `TransmogrifierSettings`, provider config unions, etc.

Published to GitHub Packages. All three consumer repos import from it.

### Companion PWA

**Library of Transmogrifia** ([kypflug/transmogrifia-pwa](https://github.com/kypflug/transmogrifia-pwa)) is a read-only PWA that shares the same OneDrive storage layer. Both apps use the same Azure AD app registration (client ID `4b54bcee-1c83-4f52-9faf-d0dfd89c5ac2`), the same `Files.ReadWrite.AppFolder` scope, and the same `articles/` folder layout:

```
/drive/special/approot/articles/
  ├── {id}.json   ← OneDriveArticleMeta (shared schema)
  └── {id}.html   ← Complete self-contained HTML
```

**Interoperability contract — any changes to these must be mirrored in the PWA:**

| Shared surface | Extension file | PWA file |
|----------------|----------------|----------|
| `OneDriveArticleMeta` interface | `@kypflug/transmogrifier-core` (canonical) | `src/types.ts` (re-exports from core) |
| OneDrive folder path (`articles/`) | `src/shared/onedrive-service.ts` (`APP_FOLDER`) | `src/services/graph.ts` (`APP_FOLDER`) |
| Graph API endpoints & auth | `src/shared/onedrive-service.ts` | `src/services/graph.ts` |
| Article ID format | `src/shared/storage-service.ts` (`generateId`) | N/A (read-only, consumes IDs) |
| Metadata JSON shape (`.json` files) | `uploadArticleMeta()` | `downloadMeta()` / `uploadMeta()` |
| Delta API usage | `getDelta()` | `syncArticles()` |

The PWA also uses delta sync, filters `.json` client-side (no `$filter`), and caches articles in its own IndexedDB (`TransmogrifiaPWA`). The extension uses `TransmogrifierDB`.

```
+------------------+     +------------------+     +------------------+
|   Popup UI       |---->|  Service Worker   |---->| Content Script   |
|  (recipe picker) |     |  (orchestrator)   |     |  (extractor)     |
+------------------+     +--------+---------+     +------------------+
                                  |
              +-------------------+-------------------+
              |                   |                   |
     +--------v--------+ +-------v------+ +----------v-------+
     |  AI Provider    | |  IndexedDB   | |  Viewer Page     |
     | (configurable)  | |  (storage)   | |  (display)       |
     +-----------------+ +-------+------+ +------------------+
                                  |
              +-------------------+-------------------+
              |                                       |
     +--------v--------+                    +---------v--------+
     |  Library Page   |                    |  OneDrive Sync   |
     | (article reader)|                    | (Graph API)      |
     +-----------------+                    +------------------+
```

**Flow:**
1. User selects a recipe and clicks **"✨ Transmogrify & Read"** (opens Library) or **"📥 Send to Library"** (silent)
2. Popup dismisses immediately; service worker fires the remix in the background
3. Service worker generates a unique request ID for tracking
4. Content script extracts semantic content (text, structure, metadata)
5. Service worker sends content + recipe prompt to the configured AI provider
6. AI returns complete HTML document as JSON
7. (Optional) Service worker generates images via configured image provider
8. Article saved to IndexedDB with original content for respins
9. Library auto-refreshes via `ARTICLES_CHANGED` broadcast
10. (If signed in) Article pushed to OneDrive AppData for cross-device sync

## Key Files & Responsibilities

| File | Purpose |
|------|---------|
| `src/content/content-extractor.ts` | Extracts semantic content from pages |
| `src/content/index.ts` | Content script message handling |
| `src/shared/ai-service.ts` | AI orchestrator — resolves config, calls core provider functions |
| `src/shared/image-service.ts` | Image orchestrator — resolves config, calls core provider functions |
| `src/shared/config.ts` | Provider types (re-exported from core) & runtime config resolution |
| `src/shared/crypto-service.ts` | AES-256-GCM encryption (device key + identity key modes) |
| `src/shared/device-key.ts` | Per-device non-extractable CryptoKey generation & storage |
| `src/shared/settings-service.ts` | Settings CRUD, identity-key sync, encrypted sync |
| `src/shared/blob-storage-service.ts` | BYOS blob upload + short link registration |
| `src/shared/storage-service.ts` | IndexedDB article storage (TransmogrifierDB) |
| `src/shared/auth-service.ts` | Microsoft OAuth2 PKCE authentication |
| `src/shared/onedrive-service.ts` | OneDrive Graph API client |
| `src/shared/sync-service.ts` | Bidirectional sync orchestrator |
| `src/settings/settings.ts` | Settings UI page logic |
| `src/popup/popup.ts` | Recipe picker + split action buttons (no tabs) |
| `src/library/library.ts` | Full two-pane article browser |
| `src/viewer/viewer.ts` | Article viewer with toolbar |
| `src/background/service-worker.ts` | Orchestrates parallel jobs + sync |

## Parallel Transmogrify System

Each Transmogrify gets a unique `requestId` for independent tracking:

```typescript
interface RemixRequest {
  requestId: string;      // UUID
  tabId: number;          // Source tab
  status: RemixStatus;    // extracting | analyzing | generating-images | saving | complete | error
  step: string;           // Current step description
  startTime: number;
  pageTitle: string;
  recipeId: string;
  error?: string;
  articleId?: string;     // Set on completion
}
```

Active Jobs stored in `chrome.storage.local` as `activeRemixes` map.
AbortControllers stored in memory for cancel support.

## Recipe System

Built-in recipes defined in `@kypflug/transmogrifier-core` (`src/recipes.ts`):
- **Reader** - Article-optimized editorial typography (default)
- **Aesthetic** - Bold, artistic presentation
- **Illustrated** - Add AI-generated illustrations
- **Visualize** - Generate diagrams and infographics
- **Interview** - Chat bubble formatting for Q&A
- **Custom** - User writes their own prompt

All recipes enforce:
- Dark mode support via `prefers-color-scheme`
- Readable typography (65-75ch width, 1.6-1.8 line-height)
- Generous whitespace
- 4.5:1 minimum contrast

### Adding a New Recipe
```typescript
// In @kypflug/transmogrifier-core src/recipes.ts (BUILT_IN_RECIPES array)
{
  id: 'myrecipe',
  name: 'My Recipe',
  description: 'What it does',
  icon: '\uD83C\uDFAF',
  supportsImages: false,  // or true for image-enabled recipes
  systemPrompt: `Instructions for the AI...`,
  userPromptTemplate: `Transform this content:\n\n{CONTENT}`,
}
```

### Working with Recipes (Cross-Repo)

Recipes live in the infra monorepo at `C:\git\transmogrifier-infra\packages\core\src\recipes.ts`. This file contains:

| Section | What it controls |
|---|---|
| `RESPONSE_FORMAT` | Shared instructions appended to all non-image recipes (HTML structure, typography, color, motion, accessibility) |
| `RESPONSE_FORMAT_WITH_IMAGES` | Same but with image placeholder instructions — used by image-enabled recipes |
| `PAGE_CHROME_SCRIPT` | Save button + reading progress bar injected into every generated page |
| `BUILT_IN_RECIPES[]` | Individual recipe definitions with per-recipe `systemPrompt` and `userPromptTemplate` |
| `buildPrompt()` | Assembles final system + user prompts from recipe + content + options |

**Debugging AI output issues:**
1. Check the shared article or generated HTML to identify the problematic CSS/HTML pattern
2. Trace whether the issue comes from `RESPONSE_FORMAT` (affects all recipes) or a specific recipe's `systemPrompt`
3. Add explicit constraints to the prompt — AI models respond well to "NEVER do X" and "ONLY do Y" phrasing
4. Prefer fixing the recipe over adding post-processing hacks in `service-worker.ts`

**Common prompt pitfalls:**
- Vague motion guidance (e.g., "subtle hover transitions") → AI invents transform effects on images, causing elements to fly around. Always specify what elements a hover/animation rule applies to and what properties are allowed
- Missing explicit constraints → AI fills in the blanks creatively, often incorrectly. If you don't want something, say so
- Teaching bad habits in one section (e.g., "images scale on entrance") that the AI generalizes to hover states

**Build & test workflow:**
```
cd C:\git\transmogrifier-infra\packages\core && npm run build
cd C:\vibes\remix-ext && npm run build
# Then reload extension in Edge and re-transmogrify a test page
```

## AI Response Format

The AI returns JSON:
```typescript
interface AIResponse {
  html: string;              // Complete HTML document
  images?: ImagePlaceholder[]; // For image-enabled recipes
  explanation?: string;      // Design choices explanation
}

interface ImagePlaceholder {
  id: string;           // e.g., "hero-image"
  prompt: string;       // Detailed prompt for image generation
  size?: string;        // "1024x1024" | "1024x1536" | "1536x1024"
  style?: string;       // "natural" | "vivid"
  altText: string;      // Accessibility
  placement: string;    // "hero" | "inline" | "background" | "accent"
}
```

Images are inserted via `{{image-id}}` placeholders in the HTML src attributes.

## Image Generation

When the user enables "Generate AI Images":
1. Recipe's `supportsImages: true` adds image instructions to prompt
2. AI returns `images` array with prompts and placements
3. Service worker calls the configured image provider for each image
4. Images returned as base64, converted to data URLs
5. Placeholders (`{{image-id}}`) replaced in HTML before saving

### Supported Image Sizes
- `1024x1024` - Square (default)
- `1024x1536` - Portrait
- `1536x1024` - Landscape

## Content Extraction

The `ContentExtractor` extracts semantic content:
- Title, author, date, site name
- Main article text with structure preserved
- Headings, lists, blockquotes, code blocks
- Image references (URLs and alt text)
- Links converted to markdown format

Output is clean text/markdown, not raw HTML.

## Storage System

Articles stored in IndexedDB (`TransmogrifierDB`) via `storage-service.ts`:

```typescript
interface SavedArticle {
  id: string;              // Timestamp-based unique ID (preserved across sync)
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  html: string;            // Complete generated HTML
  originalContent: string; // For respin capability
  createdAt: number;
  updatedAt: number;       // Last modification timestamp
  isFavorite: boolean;
}
```

Storage supports: save, get, getAll, upsert (for sync), delete, toggleFavorite, export to file.

## Library

The Library (`src/library/`) is a full-page article browser opened from the popup:
- **Two-pane layout**: Sidebar (article list) + reading pane (sandboxed iframe)
- **Search**: Full-text search across article titles
- **Filters**: By recipe, favorites only
- **Sort**: Newest, oldest, alphabetical
- **Article actions**: Favorite, Save/Export, Original link, New Tab, Respin, Delete
- **Respin modal**: Pick new recipe + optional custom prompt to re-transform
- **New Tab**: Opens article as a standalone blob URL page
- **Keyboard shortcuts**: `j`/`k` or `↑`/`↓` to browse and open, `f` to favorite, `Delete` to remove, `/` to search
- **Shortcut legend**: Floating reference in the bottom-right corner
- **In-progress remixes**: Active jobs shown at top of sidebar with live status, spinner, and cancel button
- **Live updates**: Sidebar auto-refreshes via `ARTICLES_CHANGED` broadcast from service worker
- **Resizable sidebar**: Drag handle between panes
- **Sync bar**: Sign-in status, manual sync button, sign-out button
- **Cloud-only articles**: Articles in OneDrive but not yet downloaded locally appear with a ☁ badge; lazy-downloaded on click via `SYNC_DOWNLOAD_ARTICLE`
- **Save FAB hidden**: The floating save button is hidden in the Library iframe (redundant with header save button)

## OneDrive Sync

Cross-device article sync via Microsoft Graph API:

### Architecture
- **`auth-service.ts`**: OAuth2 PKCE flow via `chrome.identity.launchWebAuthFlow`
  - Azure client ID: `4b54bcee-1c83-4f52-9faf-d0dfd89c5ac2`
  - Uses `response_mode=query` with fragment fallback for SPA redirect compatibility
  - Scopes: `Files.ReadWrite.AppFolder`, `User.Read`, `offline_access`
  - Token stored in `chrome.storage.local`, auto-refresh on expiry
  - Manifest `key` field pins the extension ID so redirect URI is stable across devices
- **`onedrive-service.ts`**: Graph API client
  - Stores articles as JSON files in OneDrive AppData special folder
  - Delta queries for efficient change detection
- **`sync-service.ts`**: Bidirectional sync orchestrator
  - Push: On article save, respin, delete, or favorite toggle
  - Pull: On extension install, every 5 minutes via `chrome.alarms`, or manual trigger
  - Conflict resolution: Latest `updatedAt` wins
  - Cloud index rebuilt exclusively from pull/delta (not updated on push)
  - `upsertArticle()` preserves original IDs and timestamps from remote articles

### Sync Flow
1. User clicks sign-in text in Library sync bar
2. `SYNC_SIGN_IN` message sent to service worker
3. Service worker initiates PKCE auth flow via `chrome.identity`
4. On success, initial pull syncs all remote articles
5. Subsequent saves/deletes automatically push to OneDrive
6. Alarm fires every 5 minutes for periodic pull
7. PWA users see changes on their next sync (delta-based)

## Settings & Key Management

All API keys and provider configuration are managed at runtime through the **Settings UI** — there are no build-time secrets or `.env` variables for API keys.

### Architecture

```
User enters keys in Settings UI
  → settings-service.ts encrypts via device key (AES-256-GCM, non-extractable CryptoKey in IndexedDB)
  → Locally-encrypted envelope stored in chrome.storage.local
  → No passphrase needed for day-to-day use

For OneDrive sync:
  → Identity key derived from Microsoft user ID via HKDF-SHA256
  → Fixed salt: "transmogrifier-settings-v2", info: "settings-encryption"
  → Deterministic: same user ID = same key on any device (no passphrase needed)
  → Settings encrypted with identity key, uploaded to /drive/special/approot/settings.enc.json
  → New device: sign in with same account → same key derived → decrypt cloud → re-encrypt with local device key
  → Legacy v1 passphrase envelopes (PBKDF2 600k) supported for one-time migration
```

### Key Types

```typescript
interface TransmogrifierSettings {
  ai?: AIProviderSettings;       // provider + credentials
  image?: ImageProviderSettings; // provider + credentials
  cloud?: CloudSettings;         // { apiUrl: string }
}

// Local storage (device key)
interface LocalEncryptedEnvelope {
  v: 1;
  iv: string;    // base64 (12 bytes)
  data: string;  // base64 ciphertext
}

// Cloud sync (identity key, v2)
interface SyncEncryptedEnvelope {
  v: 2;
  iv: string;    // base64 (12 bytes)
  data: string;  // base64 ciphertext
  // No salt — HKDF parameters are fixed
}

// Legacy cloud sync (passphrase, v1 — migration only)
interface LegacyEncryptedEnvelope {
  v: 1;
  salt: string;  // base64 (16 bytes, PBKDF2)
  iv: string;    // base64 (12 bytes)
  data: string;  // base64 ciphertext
}
```

### Crypto Parameters
- **Local encryption**: AES-256-GCM with non-extractable `CryptoKey` stored in IndexedDB (`TransmogrifierKeyStore`)
- **Cloud sync encryption**: AES-256-GCM with HKDF-SHA256 identity-derived key from Microsoft user ID
- **HKDF salt**: Fixed `"transmogrifier-settings-v2"` (UTF-8 encoded)
- **HKDF info**: Fixed `"settings-encryption"` (UTF-8 encoded)
- **IV**: 12 bytes, cryptographically random, fresh per encryption
- **Legacy migration**: v1 envelopes use PBKDF2-SHA256, 600,000 iterations — supported for one-time migration

## API Notes
- OpenAI / Azure OpenAI use `max_completion_tokens`; Anthropic uses `max_tokens`; Google uses `maxOutputTokens`
- Default timeout: 2 min (5 min for image-heavy recipes)
- Default max tokens: 16K (48K for image-heavy recipes)
- Image generation supports sizes: 1024x1024, 1024x1536, 1536x1024
- AbortController support for request cancellation
- JSON output: OpenAI/Azure use `response_format`; Google uses `responseMimeType`; Anthropic relies on prompt instructions

## Cloud Functions (Azure)

Now in the infra monorepo: **[kypflug/transmogrifier-infra](https://github.com/kypflug/transmogrifier-infra)** (`packages/api`)

The cloud backend processes transmogrification jobs asynchronously. **Note:** The extension no longer uses cloud processing — it always processes locally. Cloud queue/process is used only by the PWA (Library of Transmogrifia). The share/resolve functions are used by both.

### Architecture
```
POST /api/queue  →  Azure Storage Queue  →  Queue-trigger Function
                                                ├─ Fetch & extract page (linkedom + Readability)
                                                ├─ Call AI provider (user's keys, via core)
                                                └─ Upload to user's OneDrive approot/articles/
```

### Key Files (in `packages/api` of transmogrifier-infra)
| File | Purpose |
|------|---------|  
| `src/functions/queue.ts` | HTTP trigger: validates token, enqueues job, returns 202 |
| `src/functions/process.ts` | Queue trigger: fetch → AI → OneDrive upload |
| `src/shared/content-extractor.ts` | Server-side extraction (linkedom + Readability) |
| `src/shared/ai-service.ts` | Thin wrapper — calls `@kypflug/transmogrifier-core` provider functions |
| `src/shared/onedrive.ts` | Uploads articles to user's OneDrive |
| `src/functions/share.ts` | HTTP trigger: create/delete short links (authenticated) |
| `src/functions/resolve.ts` | HTTP trigger: resolve short code to blob URL (public) |
| `src/shared/share-registry.ts` | Azure Table Storage backend for URL shortener |

### Deployment
- **Function App**: `transmogrifier-api` at `https://transmogrifier-api.azurewebsites.net`
- **Region**: westus2 (Linux Consumption Plan)
- **Runtime**: Node 20, ESM (`"type": "module"` in package.json)
- **Timeout**: 10 minutes (`functionTimeout` in host.json — max for Consumption)
- **Application Insights**: `transmogrifier-insights` for error visibility
- **CORS**: Restricted to `https://transmogrifia.app` (extensions bypass CORS)
- **URL Shortener**: Azure Table Storage (`sharedlinks` table on same storage account) for `transmogrifia.app/shared/{code}` short links
- **Default cloud URL**: Hardcoded in `settings-service.ts` as `DEFAULT_CLOUD_URL`

### linkedom Caveat
linkedom's `parseHTML()` places HTML fragments in `documentElement`, not `body`. The content extractor's `htmlToStructuredText()` falls back to `documentElement` when `body` is empty — this is critical for correctly processing Readability's output.

## Security Notes
- **BYOK-only**: No API keys in source code, build output, or server-side config — users supply their own keys via the Settings UI
- **Encrypted at rest**: All API keys encrypted with per-device AES-256-GCM key (non-extractable, stored in IndexedDB)
- **Two-tier encryption**: Local device key for transparent access; identity-derived key (HKDF from Microsoft user ID) for OneDrive sync
- **No passphrase required**: Sync encryption key is deterministically derived from the user's Microsoft account ID
- **Zero build-time secrets**: No `import.meta.env` references; `.env` file contains no secrets
- **Cloud function is keyless**: The Azure Function has no server-side AI keys; the extension always sends the user's own keys in the request body
- Generated HTML displayed in sandboxed iframe
- No external resources loaded from generated HTML
- Images stored as embedded base64 data URLs
- OAuth2 PKCE flow (no client secret required)
- OneDrive AppData folder is app-private
- Encrypted settings optionally synced to OneDrive (`settings.enc.json`) — only decryptable with the user's identity-derived key
- **BYOS sharing**: Users provide their own Azure Blob Storage credentials for article sharing — no server-side storage costs for shared articles. Short link registry uses Azure Table Storage on the existing Functions storage account (negligible cost).

## Testing Checklist
- [ ] Test recipes on news sites, blogs, documentation
- [ ] Verify dark mode works correctly
- [ ] Test Parallel Jobs (start 2-3 simultaneously)
- [ ] Test cancel functionality
- [ ] Verify saved articles persist across sessions
- [ ] Test respin with different recipes
- [ ] Test export to HTML file
- [ ] Verify anchor links work in viewer
- [ ] Test image generation with Illustrated recipe
- [ ] Test with API errors/timeouts
- [ ] Test Library search, filter, sort
- [ ] Test Library keyboard navigation
- [ ] Test New Tab view from Library
- [ ] Test OneDrive sign-in/sign-out
- [ ] Test sync push (save, delete, favorite)
- [ ] Test sync pull (periodic and manual)
- [ ] Test sync conflict resolution
- [ ] Test article sharing (share, copy link, unshare)
- [ ] Test shared article viewer at transmogrifia.app/shared/{code}
- [ ] Test share link expiry
- [ ] Test cloud transmogrification via PWA (queue job, verify article appears in OneDrive)
- [ ] Test active remix tracking in popup (progress, error display, dismiss)

## Future Ideas
- [ ] Browser notifications when Transmogrify completes
- [ ] Site-specific recipe presets
- [ ] Streaming AI responses for faster feedback
- [ ] Image caching to avoid regeneration
- [ ] Job status endpoint (Table Storage) for PWA cloud jobs
