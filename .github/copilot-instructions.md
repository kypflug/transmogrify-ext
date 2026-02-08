# Transmogrifier - Copilot Quick Reference

> Full documentation: [claude.md](../claude.md)

## What This Is
Edge extension (Manifest V3) that uses GPT-5.2 to transform web pages into beautiful standalone HTML documents. Optional AI images via gpt-image-1.5. Articles stored in IndexedDB, synced via OneDrive.

## Tech Stack
TypeScript (strict) | Vite | Vanilla TS | Azure OpenAI | IndexedDB | Microsoft Graph API | OAuth2 PKCE

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
- Sync: push on save/delete/favorite, pull every 15 min + on demand
- Generated HTML rendered in sandboxed iframes
- 8 recipes: Focus, Reader, Aesthetic, Illustrated, Visualize, Declutter, Interview, Custom

## Code Style
- TypeScript strict mode
- Functional patterns preferred
- Content scripts kept lightweight
- Semantic HTML in UI
- `npm run build` = `tsc && vite build`
