# Changelog

All notable changes to Transmogrifier will be documented in this file.

## [0.4.4] - 2026-02-08

### Fixed
- **Critical: Article ID preservation on sync** — `saveOrUpdateArticle` no longer generates a new ID when pulling remote articles; added `upsertArticle()` to `storage-service.ts` using `store.put()` to preserve original IDs, timestamps, and favorite state. This was the root cause of duplicate articles appearing across devices.
- **Cloud index drift** — Push operations (`pushArticleToCloud`, `pushMetaUpdateToCloud`) no longer manually update the cloud index; it is now rebuilt exclusively from pull/delta results, preventing index-vs-reality divergence.
- **`$filter=endswith()` on consumer OneDrive** — Removed unsupported OData `$filter` from `listRemoteArticles`; now uses client-side `.endsWith('.json')` filtering with `$top=200` pagination.
- **Inflated pull counter** — Cloud-index-only additions (no HTML downloaded) no longer increment the `pulled` count or trigger spurious `ARTICLES_CHANGED` broadcasts.
- **Favorite toggle on cloud-only articles** — `TOGGLE_FAVORITE` handler now falls back to `toggleCloudFavorite()`, which downloads the article first, then toggles and pushes the update.

### Changed
- **Sync alarm interval** reduced from 15 minutes to 5 minutes for faster cross-device convergence.
- **Delta API optimization** — `getDelta()` now uses `@microsoft.graph.downloadUrl` from delta responses when available, avoiding an extra Graph API call per metadata file.

## [0.4.3] - 2026-02-07

### Added
- **Live Library updates** — Library page automatically picks up new articles without requiring a page refresh
  - Service worker broadcasts `ARTICLES_CHANGED` after remix, respin, delete, and sync pull
  - Library listens for broadcast and reloads article list
- **In-progress transmogrifications in Library** — Active remixes appear in the sidebar with live status
  - Pending items shown at top of sidebar list with spinner and status label
  - Clicking a pending item shows a progress reading pane with title, recipe, step, elapsed time, and cancel button
  - Automatically transitions to the completed article when generation finishes
  - Polls `chrome.storage.local` every 2s for reliable cross-context state sync
- **Content script re-injection** — After extension reload, content scripts are automatically re-injected on demand
  - Catches orphaned content script errors and re-injects JS/CSS from runtime manifest
  - Eliminates the need to refresh target pages after reloading the extension
- **Keyboard shortcuts for article skimming** — `j`/`k` (or ↑/↓) now select and open the next/previous article instantly; `f` toggles favorite; `Delete` prompts deletion
  - After deleting, the next article is automatically selected (or previous if at end of list)
- **Shortcut legend** — Floating keyboard shortcut reference in the bottom-right corner of the Library

### Changed
- **Popup buttons split** — Single "Transmogrify → New Tab" button replaced with two options:
  - **✨ Transmogrify & Read** (primary) — Starts the job and opens the Library to watch progress
  - **📥 Send to Library** (secondary) — Starts the job silently for "read later"; no navigation
  - Both options dismiss the popup immediately
- **Fire-and-forget remix** — `AI_ANALYZE` handler returns immediately so the popup can close; remix runs in background
- Completed transmogrifications no longer auto-open a viewer tab; articles land in the Library
- **Save FAB hidden in Library** — The floating save button injected by the meta prompt is hidden when viewing articles in the Library iframe (redundant with the header save button)

### Fixed
- Content extraction failing with "Could not establish connection" after extension reload/update

## [0.4.2] - 2026-02-06

### Added
- **Content extraction overhaul** — 27 CMS-specific selectors in `findMainContent()` covering WordPress, Future plc, Vox Media, Medium, Substack, and generic attribute patterns like `[itemprop="articleBody"]` and `[class*="article-body"]`
  - Div/section/span-as-paragraph fallback for CMS systems that don't use `<p>` tags
- **Tab restoration on reload** — `restoreViewerTabs()` refreshes invalidated viewer/library tabs when the extension updates

### Fixed
- **Extraction performance** — Removed `getComputedStyle()` from the DOM walk; replaced with cheap tag/class/id/attribute checks; fixes multi-second stalls on heavy pages
- **SVGAnimatedString guard** — Check on `el.className` prevents crashes on pages with inline SVGs

## [0.4.1] - 2026-02-06

### Fixed
- Extension badge text now uses ASCII labels (`AI`, `IMG`, `OK`, etc.) instead of emoji that rendered as corrupted glyphs
- Improved content extraction to filter out more site UI debris (topic/follow widgets, digest prompts, ARIA-role navigation elements)
- AI prompt updated to discard obvious website chrome (nav links, "Follow" buttons, "See All" links, etc.) from generated output

## [0.4.0] - 2025-07-08

### Added
- **Library page** — Full two-pane article browser with sidebar list and iframe reader
  - Search, filter by recipe/favorites, sort (newest, oldest, A→Z)
  - Article actions: Favorite, Save/Export, Original, New Tab, Respin, Delete
  - Respin modal with recipe picker and custom prompt
  - Delete confirmation modal
  - Resizable sidebar with drag handle
  - Keyboard navigation (↑/↓, Enter, / to search)
  - Mobile-responsive layout with back button
- **OneDrive sync** — Cross-device article sync via Microsoft Graph API
  - OAuth2 PKCE authentication via `chrome.identity.launchWebAuthFlow`
  - Articles stored as JSON in OneDrive AppData folder
  - Push on save/respin/delete/favorite
  - Pull every 15 minutes via `chrome.alarms` + manual sync
  - Delta queries for efficient change detection
  - Conflict resolution by `updatedAt` timestamp
  - Sync bar in Library with sign-in, status, and manual sync button
- **New Tab view** — Open any article as a clean standalone blob URL page
- `auth-service.ts` — Microsoft OAuth2 PKCE token management
- `onedrive-service.ts` — OneDrive Graph API client
- `sync-service.ts` — Bidirectional sync orchestrator
- `CHANGELOG.md` — Version history tracking
- `updatedAt` field on `SavedArticle` interface

### Changed
- **Renamed** project from "Focus Remix" to "Transmogrifier"
- **New extension icons** — Custom Transmogrifier branding
- **IndexedDB migration** — Database renamed from `FocusRemixDB` to `TransmogrifierDB` with automatic data migration
- **Popup simplified** — Removed tabs; popup is now a single recipe picker view with Library button
  - Top bar with "📦 Transmogrifier" brand and "📖 Library" button
  - No more "Saved" tab or inline sync UI in popup
  - Popup JS reduced from 11.21 KB to 6.03 KB
- **Recipes** — Renamed "Clean" recipe to "Declutter"; added "Interview" recipe
- Library sign-in is now a clickable text element (dotted underline) instead of a hidden button

### Removed
- Tab navigation in popup (Remix/Saved tabs)
- Inline saved articles list in popup
- Popup sync section (moved to Library)

## [0.3.0] - 2025-06-15

### Added
- **Parallel Transmogrify** — Run multiple jobs simultaneously with independent progress
  - Unique `requestId` per job (UUID)
  - Active jobs stored in `chrome.storage.local`
  - Per-job `AbortController` for cancel support
  - Independent progress tracking and status display
- Active jobs panel in popup with cancel buttons
- Stale remix cleanup functionality

## [0.2.0] - 2025-06-10

### Added
- **IndexedDB storage** — Persistent article saving via `storage-service.ts`
- **Viewer page** — Dedicated article viewer with toolbar
- **Respin** — Re-transform saved articles with different recipes
- **AI image generation** — gpt-image-1.5 integration for Illustrated and Visualize recipes
  - Image placeholders in AI response
  - Base64 data URL embedding
  - Three size options: 1024x1024, 1024x1536, 1536x1024
- Pin/unpin favorite recipes
- Export articles as standalone HTML files
- Dark mode support across all recipes

### Changed
- Recipes overhauled with stricter formatting guidelines (contrast, line-height, line-width)
- Increased timeout for image-heavy recipes (5 min vs 2 min default)

## [0.1.0] - 2025-06-01

### Added
- Initial release as "Focus Remix"
- AI-powered page transformation via GPT-5.2
- Content extraction from web pages (semantic text, structure, metadata)
- Built-in recipes: Focus, Reader, Aesthetic, Custom
- Extension popup with recipe selector
- Service worker orchestration
- Vite + TypeScript build pipeline
