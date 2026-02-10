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
  shared/          # Services: ai, image, storage, auth, onedrive, sync, crypto, settings, recipes
```

## Key Patterns
- BYOK: All API keys configured via Settings UI, encrypted at rest with per-device CryptoKey (AES-256-GCM)
- Two-tier encryption: device key (IndexedDB) for local, user passphrase (PBKDF2 600k) for OneDrive sync
- Sync passphrase in `chrome.storage.session` (memory-only); device-encrypted envelope in `chrome.storage.local`
- Popup -> service worker -> content script messaging via `chrome.runtime`
- Parallel jobs tracked by UUID `requestId` in `chrome.storage.local`
- Articles: IndexedDB save -> OneDrive push (if signed in)
- Sync: push on save/delete/favorite, pull every 5 min + on demand
- Cloud index rebuilt from pull/delta only (not updated on push)
- Generated HTML rendered in sandboxed iframes
- Cloud jobs: POST /api/queue -> Storage Queue -> queue-trigger function -> OneDrive upload
- Default cloud URL hardcoded in settings-service.ts (`transmogrifier-api.azurewebsites.net`)
- 8 recipes: Focus, Reader, Aesthetic, Illustrated, Visualize, Declutter, Interview, Custom

## Code Style
- TypeScript strict mode
- Functional patterns preferred
- Content scripts kept lightweight
- Semantic HTML in UI
- `npm run build` = `tsc && vite build`
