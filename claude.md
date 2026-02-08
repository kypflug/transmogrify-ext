# Transmogrifier - AI Development Guide

## Project Context
Transmogrifier is a Microsoft Edge extension (Manifest V3) that transforms web pages into beautiful, focused reading experiences using **AI-powered HTML generation**. It extracts semantic content from pages and sends it to a configurable AI provider (Azure OpenAI, OpenAI, Anthropic Claude, or Google Gemini) to generate complete, standalone HTML documents.

**Key Features**:
- Complete HTML generation (not DOM mutation)
- IndexedDB storage for saved articles
- Full Library page for browsing, reading, and managing articles
- OneDrive sync for cross-device article sharing
- Parallel Transmogrify support with independent progress tracking
- Live Library updates and in-progress remix display
- Content script re-injection after extension reload
- Keyboard shortcuts for article skimming
- Optional AI image generation via Azure OpenAI, OpenAI, or Google Gemini
- Dark mode support (`prefers-color-scheme`)

## Architecture Overview

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
| `OneDriveArticleMeta` interface | `src/shared/onedrive-service.ts` | `src/types.ts` |
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
| `src/shared/ai-service.ts` | Multi-provider AI integration (Azure OpenAI / OpenAI / Anthropic / Google) |
| `src/shared/image-service.ts` | Image generation (Azure OpenAI / OpenAI / Google Gemini) |
| `src/shared/config.ts` | Provider selection & env-var loading |
| `src/shared/storage-service.ts` | IndexedDB article storage (TransmogrifierDB) |
| `src/shared/auth-service.ts` | Microsoft OAuth2 PKCE authentication |
| `src/shared/onedrive-service.ts` | OneDrive Graph API client |
| `src/shared/sync-service.ts` | Bidirectional sync orchestrator |
| `src/shared/recipes.ts` | Built-in prompts and response format |
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

Built-in recipes in `recipes.ts`:
- **Focus** - Clean, distraction-free reading
- **Reader** - Article-optimized editorial typography
- **Aesthetic** - Bold, artistic presentation
- **Illustrated** - Add 5-10 AI-generated illustrations
- **Visualize** - Generate diagrams and infographics
- **Declutter** - Ultra-lightweight brutalist version
- **Interview** - Chat bubble formatting for Q&A
- **Custom** - User writes their own prompt

All recipes enforce:
- Dark mode support via `prefers-color-scheme`
- Readable typography (65-75ch width, 1.6-1.8 line-height)
- Generous whitespace
- 4.5:1 minimum contrast

### Adding a New Recipe
```typescript
// In src/shared/recipes.ts
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

## Environment Configuration

Create `.env` based on `.env.example`. Set `VITE_AI_PROVIDER` to choose your LLM backend:

```
# Provider: azure-openai | openai | anthropic | google
VITE_AI_PROVIDER=azure-openai

# --- Azure OpenAI example ---
VITE_AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
VITE_AZURE_OPENAI_API_KEY=your-key
VITE_AZURE_OPENAI_DEPLOYMENT=gpt-5.2
VITE_AZURE_OPENAI_API_VERSION=2024-10-21

# --- Or OpenAI direct ---
# VITE_OPENAI_API_KEY=sk-...
# VITE_OPENAI_MODEL=gpt-4o

# --- Or Anthropic ---
# VITE_ANTHROPIC_API_KEY=sk-ant-...
# VITE_ANTHROPIC_MODEL=claude-sonnet-4-20250514

# --- Or Google Gemini ---
# VITE_GOOGLE_API_KEY=AIza...
# VITE_GOOGLE_MODEL=gemini-2.0-flash

# Image provider: azure-openai | openai | google | none
# VITE_IMAGE_PROVIDER=azure-openai
VITE_AZURE_IMAGE_ENDPOINT=https://your-image-resource.openai.azure.com
VITE_AZURE_IMAGE_API_KEY=your-image-key
VITE_AZURE_IMAGE_DEPLOYMENT=gpt-image-1.5
VITE_AZURE_IMAGE_API_VERSION=2024-10-21
```

## API Notes
- OpenAI / Azure OpenAI use `max_completion_tokens`; Anthropic uses `max_tokens`; Google uses `maxOutputTokens`
- Default timeout: 2 min (5 min for image-heavy recipes)
- Default max tokens: 16K (48K for image-heavy recipes)
- Image generation supports sizes: 1024x1024, 1024x1536, 1536x1024
- AbortController support for request cancellation
- JSON output: OpenAI/Azure use `response_format`; Google uses `responseMimeType`; Anthropic relies on prompt instructions

## Security Notes
- API keys embedded at build time (extension-only use)
- Generated HTML displayed in sandboxed iframe
- No external resources loaded from generated HTML
- Images stored as embedded base64 data URLs
- OAuth2 PKCE flow (no client secret required)
- OneDrive AppData folder is app-private

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

## Future Ideas
- [ ] Queue system for many Parallel Jobs
- [ ] Browser notifications when Transmogrify completes
- [ ] Site-specific recipe presets
- [ ] Streaming AI responses for faster feedback
- [ ] Image caching to avoid regeneration
