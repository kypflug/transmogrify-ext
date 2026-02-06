# Transmogrifications Reader — Spec

## Overview

A full-page **reader app** for browsing saved transmogrifications, accessible from the extension popup. Two-pane layout: article list on the left, selected article rendered inline on the right. Think RSS reader / email client UX — lightweight, fast, keyboard-navigable.

---

## Entry Point

- **From the popup**: A "📖 Open Library" button/link in the Saved tab header opens the reader in a new tab via `chrome.runtime.getURL('src/library/library.html')`.
- **From the viewer**: A "📖 Library" button in the viewer toolbar navigates to the reader (or opens it in a new tab if not already open).
- **Direct URL**: `chrome-extension://<id>/src/library/library.html` — bookmarkable.

The popup's existing Saved tab remains as a compact quick-access list. The library is the full reading experience.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  📦 Transmogrifier Library                           [Transmogrify ▾]  │
├────────────────────┬─────────────────────────────────────────────────────┤
│ Search ________    │                                                    │
│ ──────────────── │                                                    │
│ Filter: All ▾      │                                                    │
│ Sort: Newest ▾     │                                                    │
│ ──────────────── │     (select an article to read)                    │
│                    │                                                    │
│ ★ Article Title 1  │                                                    │
│   Focus · Jan 15   │                                                    │
│                    │                                                    │
│ ▸ Article Title 2  │                                                    │
│   Reader · Jan 14  │                                                    │
│                    │                                                    │
│ ▸ Article Title 3  │                                                    │
│   Illustrated·Jan12│                                                    │
│                    │                                                    │
│                    │                                                    │
│                    │                                                    │
│ ──────────────── │                                                    │
│ 12 articles · 4 MB │                                                    │
└────────────────────┴─────────────────────────────────────────────────────┘
```

### Selected state

```
┌──────────────────────────────────────────────────────────────────────────┐
│  📦 Transmogrifier Library                           [Transmogrify ▾]  │
├────────────────────┬─────────────────────────────────────────────────────┤
│ Search ________    │ Article Title 1                                    │
│ ──────────────── │ Source: example.com  ·  Focus  ·  Jan 15           │
│ Filter: All ▾      │ ☆ Favorite  💾 Save  🔗 Original  🔄 Respin  🗑️  │
│ Sort: Newest ▾     │ ─────────────────────────────────────────────────── │
│ ──────────────── │                                                    │
│                    │  ┌─────────────────────────────────────────────┐   │
│ █ Article Title 1  │  │                                             │   │
│   Focus · Jan 15   │  │     (transmogrified article rendered        │   │
│                    │  │      in sandboxed iframe)                   │   │
│ ▸ Article Title 2  │  │                                             │   │
│   Reader · Jan 14  │  │                                             │   │
│                    │  │                                             │   │
│ ▸ Article Title 3  │  │                                             │   │
│   Illustrated·Jan12│  │                                             │   │
│                    │  │                                             │   │
│                    │  │                                             │   │
│                    │  └─────────────────────────────────────────────┘   │
│ ──────────────── │                                                    │
│ 12 articles · 4 MB │                                                    │
└────────────────────┴─────────────────────────────────────────────────────┘
```

---

## Article Side Panel (Left)

### Width
- Default: 320px
- Resizable via drag handle (min 240px, max 480px)
- Width persisted in `chrome.storage.local`

### Header
- App icon + "Transmogrifier Library" title
- Search input: filters articles by title (debounced, client-side)
- Filter dropdown: **All**, **Favorites**, or by recipe name
- Sort dropdown: **Newest first**, **Oldest first**, **Alphabetical**

### Article List Items
Each item shows:
- **Favorite indicator**: ★ (gold) for favorites, none otherwise
- **Title**: Truncated to 2 lines
- **Recipe icon + name**: e.g. "🎯 Focus"
- **Date**: Relative ("2h ago", "Yesterday", "Jan 15") 
- **Selected state**: Highlighted background, left border accent

### Footer
- Article count and total storage size: "12 articles · 4.2 MB"

### Empty State
- Friendly illustration/icon
- "No transmogrifications yet"
- "Visit any web page and click Transmogrify to get started"

---

## Reading Pane (Right)

### Article Header Bar
A slim bar above the iframe:
- **Title** (full, not truncated)
- **Source domain + date + recipe name**
- **Action buttons** (icon + text on wide screens, icon-only on narrow):
  - ☆ Favorite (toggle)
  - 💾 Save to file (export)
  - 🔗 Open original
  - 🔄 Respin (opens respin modal, same as existing viewer)
  - 🗑️ Delete (with confirmation)

### Content Area
- Sandboxed `<iframe>` rendering the article HTML via `srcdoc`
- `sandbox="allow-same-origin allow-scripts"` (same as existing viewer)
- Takes full remaining height
- Anchor link fixing (reuse existing `fixAnchorLinks()` logic)
- Listens for `TRANSMOGRIFY_SAVE` messages from iframe's save button

### Empty / No Selection State
- Centered message: "Select an article to read"
- Subtle icon or illustration

---

## Transmogrify Button (Header)

A "Transmogrify" dropdown button in the top-right corner of the library provides quick access to transmogrify the current browser tab without going back to the popup:

- **Primary click**: Opens a dropdown showing recipe list
- Select a recipe → transmogrify the active tab → article appears in the list when complete
- Include "Generate AI Images" toggle
- Re-uses existing `AI_ANALYZE` message flow

This is a stretch goal — nice to have but not required for v1.

---

## Keyboard Navigation

| Key | Action |
|---|---|
| `↓` / `j` | Next article in list |
| `↑` / `k` | Previous article in list |
| `Enter` | Open selected article (if list focused) |
| `Escape` | Close respin modal / clear search |
| `Ctrl+F` / `⌘+F` | Focus search input |
| `Delete` | Delete selected article (with confirmation) |
| `f` | Toggle favorite on selected article |

---

## Responsive Behavior

| Viewport | Behavior |
|---|---|
| ≥ 900px | Side-by-side two-pane layout |
| < 900px | Stacked: list view → tap article → reading view with back button |
| < 600px | Full-width reading view, hamburger to toggle list |

---

## New Files

```
src/library/
  library.html          # Full-page reader app
  library.ts            # List management, selection, actions
  library.css           # Two-pane layout styles
```

---

## Data Flow

The library reads and writes using the **same IndexedDB** and **same message types** as the existing popup and viewer. No new storage or message types needed.

```
library.ts
  ├── GET_ARTICLES       → list all articles (summaries)
  ├── GET_ARTICLE        → load full HTML for reading pane
  ├── TOGGLE_FAVORITE    → star/unstar
  ├── EXPORT_ARTICLE     → download as HTML
  ├── DELETE_ARTICLE     → remove
  ├── RESPIN_ARTICLE     → re-transmogrify with different recipe
  └── OPEN_ARTICLE       → (not needed — renders inline)
```

Alternatively, the library page can import from `storage-service.ts` directly (like the existing viewer does) to avoid service worker round-trips for reads. It would only use messages for operations that need the service worker (respin, transmogrify).

---

## Manifest Changes

Add the library page to `web_accessible_resources`:

```json
"web_accessible_resources": [
  {
    "resources": ["src/viewer/viewer.html", "src/library/library.html"],
    "matches": ["<all_urls>"]
  }
]
```

---

## Integration with Popup

### Saved Tab Changes
Add a button to the Saved tab header:

```html
<header class="saved-header">
  <h2>Saved Articles</h2>
  <div class="saved-header-actions">
    <span class="storage-info" id="storageInfo"></span>
    <button class="library-btn" id="openLibraryBtn" title="Open Library">📖</button>
  </div>
</header>
```

Clicking opens `library.html` in a new tab.

---

## Integration with Viewer

The existing single-article viewer (`viewer.html`) continues to work as-is. It's used when:
- A transmogrification completes (auto-opens in new tab)
- User clicks an article from the popup's Saved tab

The library is a separate, richer experience for browsing the full collection. Users will naturally gravitate toward the library for reading; the viewer remains the "just finished" landing page.

### Optional (v2): Redirect Viewer → Library
Later, `OPEN_ARTICLE` could open the library with the article pre-selected instead of the single-article viewer. This would be a one-line change in the service worker.

---

## Visual Design

- **Color palette**: Inherit from popup — Segoe UI Variable, `#0078D4` accent, `#F3F3F3` background
- **Dark mode**: Respect `prefers-color-scheme: dark` throughout
- **Transitions**: Smooth 150ms transitions on selection, hover states
- **Scrolling**: Custom thin scrollbar matching popup style
- **Typography**: 13–14px for list items, standard sizes for article header

---

## Implementation Phases

### Phase 1 — Core Two-Pane Reader
1. `library.html` + `library.css` + `library.ts` scaffolding
2. Article list loaded from IndexedDB (direct import)
3. Click article → render in iframe
4. Article header bar with all action buttons
5. Empty state for no articles and no selection
6. "Open Library" button in popup
7. Manifest update

### Phase 2 — Search, Filter, Sort
1. Client-side search by title
2. Filter by recipe / favorites
3. Sort options (newest, oldest, alphabetical)
4. Persisted sort/filter preferences

### Phase 3 — Keyboard Nav + Responsive
1. Keyboard shortcuts
2. Responsive stacked layout for narrow viewports
3. Resizable side panel with drag handle

### Phase 4 — Polish
1. Dark mode
2. Smooth transitions and loading states
3. Relative date formatting
4. Panel width persistence

---

## Non-Goals (v1)

- Transmogrify-from-library button (stretch / v2)
- Bulk operations (multi-select delete)
- Article tags or categories beyond recipe
- Drag-and-drop article reordering
- Import articles from files
