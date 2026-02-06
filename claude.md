# Transmogrifier - AI Development Guide

## Project Context
Transmogrifier is a Microsoft Edge extension (Manifest V3) that transforms web pages into beautiful, focused reading experiences using **AI-powered HTML generation**. It extracts semantic content from pages and uses GPT-5.2 to generate complete, standalone HTML documents.

**Key Features**:
- Complete HTML generation (not DOM mutation)
- IndexedDB storage for saved articles
- Full Library page for browsing, reading, and managing articles
- OneDrive sync for cross-device article sharing
- Parallel Transmogrify support with independent progress tracking
- Optional AI image generation via gpt-image-1.5
- Dark mode support (`prefers-color-scheme`)

## Architecture Overview

```
+------------------+     +------------------+     +------------------+
|   Popup UI       |---->|  Service Worker   |---->| Content Script   |
|  (recipe picker) |     |  (orchestrator)   |     |  (extractor)     |
+------------------+     +--------+---------+     +------------------+
                                  |
              +-------------------+-------------------+
              |                   |                   |
     +--------v--------+ +-------v------+ +----------v-------+
     |  Azure OpenAI   | |  IndexedDB   | |  Viewer Page     |
     | GPT-5.2 + img   | |  (storage)   | |  (display)       |
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
1. User selects a recipe and clicks "Transmogrify -> New Tab"
2. Service worker generates a unique request ID for tracking
3. Content script extracts semantic content (text, structure, metadata)
4. Service worker sends content + recipe prompt to GPT-5.2
5. AI returns complete HTML document as JSON
6. (Optional) Service worker generates images via gpt-image-1.5
7. Article saved to IndexedDB with original content for respins
8. Viewer page opens displaying the transmogrified article
9. (If signed in) Article pushed to OneDrive AppData for cross-device sync

## Key Files & Responsibilities

| File | Purpose |
|------|---------|
| `src/content/content-extractor.ts` | Extracts semantic content from pages |
| `src/content/index.ts` | Content script message handling |
| `src/shared/ai-service.ts` | Azure OpenAI GPT-5.2 integration |
| `src/shared/image-service.ts` | Azure OpenAI gpt-image-1.5 integration |
| `src/shared/storage-service.ts` | IndexedDB article storage (TransmogrifierDB) |
| `src/shared/auth-service.ts` | Microsoft OAuth2 PKCE authentication |
| `src/shared/onedrive-service.ts` | OneDrive Graph API client |
| `src/shared/sync-service.ts` | Bidirectional sync orchestrator |
| `src/shared/recipes.ts` | Built-in prompts and response format |
| `src/popup/popup.ts` | Recipe picker + library link (no tabs) |
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
  prompt: string;       // Detailed prompt for gpt-image-1.5
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
3. Service worker calls gpt-image-1.5 for each image
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
  id: string;              // Timestamp-based unique ID
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

Storage supports: save, get, getAll, delete, toggleFavorite, export to file.

## Library

The Library (`src/library/`) is a full-page article browser opened from the popup:
- **Two-pane layout**: Sidebar (article list) + reading pane (sandboxed iframe)
- **Search**: Full-text search across article titles
- **Filters**: By recipe, favorites only
- **Sort**: Newest, oldest, alphabetical
- **Article actions**: Favorite, Save/Export, Original link, New Tab, Respin, Delete
- **Respin modal**: Pick new recipe + optional custom prompt to re-transform
- **New Tab**: Opens article as a standalone blob URL page
- **Keyboard navigation**: Arrow keys, Enter, / to focus search
- **Resizable sidebar**: Drag handle between panes
- **Sync bar**: Sign-in status, manual sync button

## OneDrive Sync

Cross-device article sync via Microsoft Graph API:

### Architecture
- **`auth-service.ts`**: OAuth2 PKCE flow via `chrome.identity.launchWebAuthFlow`
  - Azure client ID: `4b54bcee-1c83-4f52-9faf-d0dfd89c5ac2`
  - Scopes: `Files.ReadWrite.AppFolder`, `User.Read`, `offline_access`
  - Token stored in `chrome.storage.local`, auto-refresh on expiry
- **`onedrive-service.ts`**: Graph API client
  - Stores articles as JSON files in OneDrive AppData special folder
  - Delta queries for efficient change detection
- **`sync-service.ts`**: Bidirectional sync orchestrator
  - Push: On article save, respin, delete, or favorite toggle
  - Pull: On extension install, every 15 minutes via `chrome.alarms`, or manual trigger
  - Conflict resolution: Latest `updatedAt` wins

### Sync Flow
1. User clicks sign-in text in Library sync bar
2. `SYNC_SIGN_IN` message sent to service worker
3. Service worker initiates PKCE auth flow via `chrome.identity`
4. On success, initial pull syncs all remote articles
5. Subsequent saves/deletes automatically push to OneDrive
6. Alarm fires every 15 minutes for periodic pull

## Environment Configuration

Create `.env` with:
```
# GPT-5.2 for HTML generation
VITE_AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
VITE_AZURE_OPENAI_API_KEY=your-key
VITE_AZURE_OPENAI_DEPLOYMENT=gpt-5.2
VITE_AZURE_OPENAI_API_VERSION=2024-10-21

# (Optional) gpt-image-1.5 for AI image generation
VITE_AZURE_IMAGE_ENDPOINT=https://your-image-resource.openai.azure.com
VITE_AZURE_IMAGE_API_KEY=your-image-key
VITE_AZURE_IMAGE_DEPLOYMENT=gpt-image-1.5
VITE_AZURE_IMAGE_API_VERSION=2024-10-21
```

## API Notes
- GPT-5.2 uses `max_completion_tokens` (not `max_tokens`)
- Default timeout: 2 min (5 min for image-heavy recipes)
- Default max tokens: 16K (48K for image-heavy recipes)
- gpt-image-1.5 supports sizes: 1024x1024, 1024x1536, 1536x1024
- AbortController support for request cancellation

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
