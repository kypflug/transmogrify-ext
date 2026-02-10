# Changelog

All notable changes to Transmogrifier will be documented in this file.

## [0.5.2] - 2026-02-09

### Added
- **Cloud image generation** — Cloud pipeline now generates AI images from placeholders in the AI response, supporting Azure OpenAI, OpenAI, and Google Gemini. Image config sent from extension/PWA with each cloud job.
- **Parallel image generation (cloud)** — Cloud images generated in concurrent batches of 3 (was sequential), with a 90-second per-image timeout. An 8-image job that previously timed out now completes in ~3 minutes.
- **Mobile viewport support** — All recipe prompts and the shared `RESPONSE_FORMAT` now include explicit instructions for phone viewports down to 375px (iPhone SE): fluid `clamp()` typography, single-column collapse, no horizontal scroll, iOS Safari caveats (`100dvh`, no `background-attachment: fixed`, 44×44px tap targets).
- **Pending-deletes system** — `syncPendingDeletes` in `chrome.storage.local` tracks recently deleted article IDs for 30 minutes, preventing delta eventual consistency from re-adding them during pull.
- **Cloud job resolution** — `resolveCloudJobs()` matches pending cloud-queued remixes against synced articles by source URL, clearing stale "pending" status. Runs on every sync alarm (5 min).
- **Alarm-based cleanup** — `cleanupStaleRemixes()` and `resolveCloudJobs()` now run on `chrome.alarms.onAlarm` instead of a one-shot `setTimeout`, surviving service worker suspension.

### Fixed
- **Cloud HTML unescaping** — Cloud `parseAIResponse` was missing the `\\n`/`\\t`/`\\"` unescape step, producing literal escape sequences in generated HTML. Now matches the extension's parsing logic.
- **Cloud `max_tokens` → `max_completion_tokens`** — Azure OpenAI and OpenAI adapters in cloud `ai-service.ts` now use the correct parameter name (newer models reject `max_tokens`).
- **Deleted articles reappearing** — Delta upserts now filtered against pending-deletes; `downloadCloudArticle` self-heals on 404 by removing stale entries from the cloud index.
- **Delete race condition** — `DELETE_ARTICLE` handler now awaits local cleanup (`prepareDeleteForSync`) before broadcasting `ARTICLES_CHANGED`, preventing `getMergedArticleList` from immediately re-adding the article as cloud-only.
- **"Failed to download article"** — Changed to "Article no longer available" with automatic list refresh when a cloud-only article 404s.
- **Stuck cloud remixes** — Service worker now enforces 15-minute max age on cloud-queued remixes at startup.

### Changed
- **Image count limits tightened** — Illustrated recipe: 3–5 images (was 5–10). Visualize: 2–4 (was unbounded). Shared `RESPONSE_FORMAT_WITH_IMAGES`: "2–5, prefer the low end, absolute max 10."
- **Cloud recipes synced** — Cloud recipe prompts now match extension prompts exactly, including all responsive design rules, interview chat structure, and aesthetic mood options.
- **Image generation timing logged** — Cloud process function now logs concurrency level and total image generation duration.
- **Interview recipe** — Prescriptive HTML/CSS structure for proper chat bubble alignment, avatar positioning, and responsive breakpoints.
- **Aesthetic recipe** — Added responsive design rules (fluid typography, grid collapse, overflow handling).
- **Visualize recipe** — Added responsive rules and image handling (`max-width`, `object-fit:contain`, preserve source image links).
- **Default `max_completion_tokens`** — Increased from 16384 to 32768 to prevent truncation on longer articles.
- **`.funcignore`** — Excludes `node_modules` but keeps `.ts` files for remote build.

## [0.5.1] - 2026-02-09

### Added
- **Cloud function deployed** — Azure Functions backend live at `https://transmogrifier-api.azurewebsites.net` (westus2, Node 20, Linux Consumption Plan)
- **Application Insights** — `transmogrifier-insights` connected to the function app for error visibility and log streaming
- **Active remix tracking in popup** — Cloud-queued and local jobs shown in popup with live status, error display, and dismiss/cancel buttons
- **Error persistence** — Errored jobs stay visible in popup until the user dismisses them (no auto-cleanup)
- **Default cloud URL** — `settings-service.ts` now hardcodes `https://transmogrifier-api.azurewebsites.net` as the default cloud endpoint; no manual configuration needed

### Fixed
- **Content extraction bug (cloud)** — linkedom's `parseHTML()` places HTML fragments in `documentElement`, not `body`. `htmlToStructuredText()` now falls back to `documentElement` when `body` has no children. Previously, articles extracted server-side had zero body content (only title/author metadata).
- **`new Blob()` → `Buffer.byteLength()`** — Replaced browser-only `Blob` constructor in `process.ts` with Node-native `Buffer.byteLength()` for article size calculation

### Changed
- **Function timeout** — `host.json` now sets `functionTimeout` to 10 minutes (Consumption plan max), up from the 5-minute default. AI generation with large articles can exceed 5 minutes.
- **CORS tightened** — Cloud function CORS restricted from `*` to `https://transmogrifia.app` only (extensions bypass CORS)
- **Cloud Processing settings removed** — Removed redundant Cloud Processing section from Settings UI; cloud URL uses the hardcoded default

## [0.5.0] - 2026-02-09

### Added
- **Settings UI** — In-extension settings page (`src/settings/`) for configuring API keys, providers, cloud endpoint, and sync passphrase. Accessible via the popup gear icon or extension context menu.
- **Two-tier encrypted key storage** — Local settings encrypted with a per-device AES-256-GCM key (non-extractable `CryptoKey` stored in IndexedDB). No passphrase needed for day-to-day use. For OneDrive sync, a separate user passphrase encrypts settings with PBKDF2 (600,000 iterations per OWASP 2023).
- **Settings sync** — Encrypted settings sync to OneDrive at `/drive/special/approot/settings.enc.json` for cross-device key portability. Enter the same passphrase on a new device to decrypt and import.
- `device-key.ts` — Per-device non-extractable CryptoKey generation and storage in IndexedDB (`TransmogrifierKeyStore`)
- `crypto-service.ts` — AES-256-GCM encrypt/decrypt with two modes: device key (local) and passphrase/PBKDF2 (cloud sync)
- `settings-service.ts` — Settings CRUD, passphrase management, config resolution, encrypted sync helpers
- `cloud-queue-service.ts` — Cloud function queue client with BYOK (always sends user's keys)

### Changed
- **BYOK-only architecture** — All API keys are now user-supplied via the Settings UI. No build-time secrets, no `.env` API keys, no server-side AI keys. The cloud function receives AI credentials from the caller in every request.
- **`config.ts` rewritten** — Removed all `import.meta.env` references and `buildAIConfig()`/`buildImageConfig()` functions. Provider config now resolved at runtime from encrypted settings via `resolveAIConfig()`, `resolveImageConfig()`, `resolveCloudUrl()`.
- **Cloud function keyless** — Removed `getConfig()` server-side fallback from cloud `ai-service.ts`. `aiConfig` is now required on `TransmogrifyJob` and `QueueRequest` types; `queue.ts` returns 400 if missing.
- **`.env` stripped** — Extension `.env` and `.env.example` contain no secrets; `vite-env.d.ts` stripped to Vite reference only.
- **Documentation updated** — README.md, claude.md, cloud/README.md, and copilot-instructions.md all updated to reflect BYOK architecture and Settings UI.

### Security
- API keys never appear in source code, build output, or server-side configuration
- Local settings encrypted with non-extractable device key (AES-256-GCM) — persists across sessions, no user input needed
- Cloud sync uses separate passphrase encryption (PBKDF2, 600k iterations) — passphrase held in memory only
- 12-byte random IV generated fresh per encryption operation
- Zero `import.meta.env` references in codebase — verified via grep

## [0.4.6] - 2026-02-08

### Added
- **Stable extension ID** — Manifest `key` field pins the extension ID across devices, so the OAuth redirect URI is consistent without re-registering in Azure AD
- **Cloud-only articles in Library** — Library now uses `getMergedArticleList()` to show articles that exist in OneDrive but haven't been downloaded locally, with a ☁ cloud badge; clicking a cloud-only article downloads it on demand via `SYNC_DOWNLOAD_ARTICLE`
- **Sign-out button** — Sync bar in Library now shows a sign-out button when signed in

### Fixed
- **OAuth SPA redirect handling** — Added `response_mode=query` to the auth URL and fragment-fallback parsing, fixing sign-in failures when the redirect URI is registered as a Single-page application in Azure AD

## [0.4.5] - 2026-02-08

### Added
- **Multi-provider AI support** — The extension now supports four AI providers, selected at build time via `VITE_AI_PROVIDER`:
  - **Azure OpenAI** (default, backwards-compatible)
  - **OpenAI** (direct API)
  - **Anthropic** (Claude)
  - **Google** (Gemini)
- **Multi-provider image generation** — Image generation now supports OpenAI direct and Google Gemini (Nano Banana) in addition to Azure OpenAI, via `VITE_IMAGE_PROVIDER`
- **`getProviderName()`** helper for human-readable provider display in error messages and logs
- **Provider-specific adapters** in `ai-service.ts` — `callAzureOpenAI`, `callOpenAI`, `callAnthropic`, `callGoogle` each handle URL construction, auth headers, request format, and response parsing

### Changed
- **`config.ts` rewritten** — Monolithic `AIConfig`/`ImageConfig` interfaces replaced with discriminated union types (`AzureOpenAIConfig | OpenAIConfig | AnthropicConfig | GoogleConfig`) for type-safe provider switching
- **`ai-service.ts` refactored** — Provider-specific logic extracted from `analyzeWithAI()` into separate adapter functions; shared `parseOpenAIResponse()` for Azure OpenAI and OpenAI direct
- **`image-service.ts` refactored** — `generateSingleImage()` now dispatches to `generateAzureImage()`, `generateOpenAIImage()`, or `generateGoogleImage()` based on active provider
- **`.env.example` expanded** — Full multi-provider template with all four text providers and both image providers
- **README.md** — New multi-provider feature bullet, expanded prerequisites with provider links, per-provider `.env` configuration examples, image generation provider docs
- **claude.md** — Updated architecture diagram, file descriptions, env config section, and API notes
- **copilot-instructions.md** — Updated tech stack and description

## [0.4.4] - 2026-02-08

### Added
- **Sync reconciliation** — `pullFromCloud` now detects local articles missing from the cloud index and pushes them automatically, self-healing any articles whose initial push failed silently

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
