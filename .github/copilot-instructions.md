# Transmogrifier - Copilot Quick Reference

> Full documentation: [claude.md](../claude.md)

## What This Is
Edge extension (Manifest V3) that uses an LLM (Azure OpenAI, OpenAI, Anthropic Claude, or Google Gemini) to transform web pages into beautiful standalone HTML documents. Optional AI images via Azure OpenAI, OpenAI, or Google Gemini. Articles stored in IndexedDB, synced via OneDrive.

## Companion PWA
**Library of Transmogrifia** ([kypflug/transmogrifia-pwa](https://github.com/kypflug/transmogrifia-pwa)) — Read-only PWA for browsing transmogrified articles on any device. Shares the same Azure AD app, OneDrive `articles/` folder, and `OneDriveArticleMeta` schema. Changes to sync logic, storage format, or the OneDrive file layout **must** stay compatible with the PWA's `src/services/graph.ts` and `src/types.ts`.

## Tech Stack
TypeScript (strict) | Vite | Vanilla TS | Multi-provider AI (Azure OpenAI / OpenAI / Anthropic / Google) | AES-256-GCM encrypted settings | IndexedDB | Microsoft Graph API | OAuth2 PKCE | Azure Functions v4 (Node 20, ESM)

## Structure
```
src/
  content/         # Content extraction from pages
  popup/           # Recipe picker + split action buttons (no tabs)
  library/         # Full-page two-pane article browser
  settings/        # Settings UI (API keys, providers, encryption passphrase)
  viewer/          # Article viewer page
  background/      # Service worker (orchestration + sync)
  shared/          # Services: ai, image, storage, auth, onedrive, sync, crypto, settings, recipes, blob-storage
```

## Key Patterns
- BYOK: All API keys configured via Settings UI, encrypted at rest with per-device CryptoKey (AES-256-GCM)
- BYOS: Article sharing uses user's own Azure Blob Storage (configured in Settings, synced via encrypted settings)
- Two-tier encryption: device key (IndexedDB) for local, user passphrase (PBKDF2 600k) for OneDrive sync
- Sync passphrase in `chrome.storage.session` (memory-only); device-encrypted envelope in `chrome.storage.local`
- Popup -> service worker -> content script messaging via `chrome.runtime`
- Parallel jobs tracked by UUID `requestId` in `chrome.storage.local`
- Articles: IndexedDB save -> OneDrive push (if signed in)
- Sync: push on save/delete/favorite, pull every 5 min + on demand
- Cloud index rebuilt from pull/delta only (not updated on push)
- Generated HTML rendered in sandboxed iframes
- Cloud jobs: POST /api/queue -> Storage Queue -> queue-trigger function -> OneDrive upload
- Sharing: blob upload -> POST /api/share -> Table Storage short link -> transmogrifia.app/shared/{code}
- Short link resolver: GET /api/s/{code} -> blob URL (public, no auth)
- Default cloud URL hardcoded in settings-service.ts (`transmogrifier-api.azurewebsites.net`)
- 8 recipes: Focus, Reader, Aesthetic, Illustrated, Visualize, Declutter, Interview, Custom

## Code Style
- TypeScript strict mode
- Functional patterns preferred
- Content scripts kept lightweight
- Semantic HTML in UI
- `npm run build` = `tsc && vite build`

## Cloud Functions (Azure)
- Deploy: `cd cloud && func azure functionapp publish transmogrifier-api --build remote`
- ALWAYS use `--build remote` — this excludes `node_modules` (via `.funcignore`) and builds TypeScript on the server
- Never deploy without `--build remote`; uploading `node_modules` locally creates 500MB+ packages that time out
- `.funcignore` must keep `node_modules` excluded and must NOT exclude `*.ts` or `tsconfig.json` (needed for remote build)

## AI Provider API Gotchas
- **OpenAI / Azure OpenAI**: use `max_completion_tokens` (NOT `max_tokens` — the old parameter is rejected by newer models like o1/o3/o4)
- **Anthropic**: use `max_tokens` (their API still uses the old name)
- **Google Gemini**: use `maxOutputTokens` inside `generationConfig`
- Always keep the cloud function (`cloud/src/shared/ai-service.ts`) in sync with the extension (`src/shared/ai-service.ts`)
