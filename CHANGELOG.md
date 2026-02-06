# Changelog

All notable changes to Transmogrifier will be documented in this file.

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
