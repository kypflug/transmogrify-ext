# Transmogrifier - Copilot Quick Reference

> Full documentation: [claude.md](../claude.md)

## What This Is
Edge extension (Manifest V3) that uses an LLM (Azure OpenAI, OpenAI, Anthropic Claude, or Google Gemini) to transform web pages into beautiful standalone HTML documents. Optional AI images via OpenAI-family providers. Articles stored in IndexedDB, synced via OneDrive.

## Companion PWA
**Library of Transmogrifia** ([kypflug/transmogrifia-pwa](https://github.com/kypflug/transmogrifia-pwa)) — Read-only PWA for browsing transmogrified articles on any device. Shares the same Azure AD app, OneDrive `articles/` folder, and `OneDriveArticleMeta` schema. Changes to sync logic, storage format, or the OneDrive file layout **must** stay compatible with the PWA's `src/services/graph.ts` and `src/types.ts`.

## Tech Stack
TypeScript (strict) | Vite | Vanilla TS | Multi-provider AI (Azure OpenAI / OpenAI / Anthropic / Google) | IndexedDB | Microsoft Graph API | OAuth2 PKCE

## Structure
```
src/
  content/         # Content extraction from pages
  popup/           # Recipe picker + split action buttons (no tabs)
  library/         # Full-page two-pane article browser
  viewer/          # Article viewer page
  background/      # Service worker (orchestration + sync)
  shared/          # Services: ai, image, storage, auth, onedrive, sync, recipes
```

## Key Patterns
- Popup -> service worker -> content script messaging via `chrome.runtime`
- Parallel jobs tracked by UUID `requestId` in `chrome.storage.local`
- Articles: IndexedDB save -> OneDrive push (if signed in)
- Sync: push on save/delete/favorite, pull every 5 min + on demand
- Cloud index rebuilt from pull/delta only (not updated on push)
- Generated HTML rendered in sandboxed iframes
- 8 recipes: Focus, Reader, Aesthetic, Illustrated, Visualize, Declutter, Interview, Custom

## Code Style
- TypeScript strict mode
- Functional patterns preferred
- Content scripts kept lightweight
- Semantic HTML in UI
- `npm run build` = `tsc && vite build`
