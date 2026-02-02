# Parallel Remix Implementation Plan

## Problem
Currently, the extension uses a single shared progress state, making it impossible to track multiple concurrent remix operations across different tabs.

## Goal
Allow users to start remixes on multiple tabs simultaneously, each with independent progress tracking.

---

## Architecture Changes

### 1. Request ID System
Each remix operation gets a unique ID that travels with it through the entire flow.

```typescript
interface RemixRequest {
  requestId: string;      // UUID generated at start
  tabId: number;          // Source tab
  status: RemixStatus;
  step: string;
  startTime: number;
  pageTitle: string;
  recipeId: string;
  error?: string;
  articleId?: string;     // Set on completion
}
```

### 2. Progress Storage (Multi-Request)
Replace single `remixProgress` with a map of active requests:

```typescript
// chrome.storage.local
{
  activeRemixes: {
    [requestId: string]: RemixRequest
  }
}
```

### 3. Badge Strategy Options

**Option A: Show count**
- Badge shows number of active remixes: "2", "3", etc.
- Color indicates if any have errors (red) or all good (purple)

**Option B: Rotating display**
- Cycle through active request statuses every 2 seconds
- Shows emoji for current phase of each

**Option C: Most recent only**
- Badge shows status of most recently started remix
- Simpler but less informative

**Recommendation**: Option A (count) - simple and clear

### 4. Popup UI Changes

Current popup shows single progress bar. New design:

```
┌─────────────────────────────────────┐
│  Focus Remix                    [⚙] │
├─────────────────────────────────────┤
│  Active Remixes (2)                 │
│  ┌────────────────────────────────┐ │
│  │ 🤖 Blog Post Title...          │ │
│  │    AI generating HTML (45s)    │ │
│  │    [Cancel]                    │ │
│  └────────────────────────────────┘ │
│  ┌────────────────────────────────┐ │
│  │ 🎨 Another Article             │ │
│  │    Generating 5 images...      │ │
│  │    [Cancel]                    │ │
│  └────────────────────────────────┘ │
├─────────────────────────────────────┤
│  [Remix This Page ▼]                │
├─────────────────────────────────────┤
│  📚 Saved Articles                  │
│  ...                                │
└─────────────────────────────────────┘
```

### 5. Cancel Support
With request IDs, we can implement cancel:
- Store `AbortController` reference per request in service worker memory
- Popup sends `CANCEL_REMIX` with `requestId`
- Service worker calls `controller.abort()`

---

## Implementation Steps

### Phase 1: Request ID Infrastructure
**Files**: `service-worker.ts`, `types.ts`

1. Add `RemixRequest` interface to types
2. Generate UUID at start of `performRemix()` / `performRespin()`
3. Store requests in `activeRemixes` map instead of single `remixProgress`
4. Update `getProgress()` → `getActiveRemixes()`
5. Update `updateProgress()` → `updateRemixProgress(requestId, ...)`
6. Clean up completed/errored requests after 10 seconds

### Phase 2: Message Protocol Update
**Files**: `types.ts`, `service-worker.ts`, `popup.ts`

1. `AI_ANALYZE` response includes `requestId`
2. `PROGRESS_UPDATE` messages include `requestId`
3. New message: `GET_ACTIVE_REMIXES` returns all active
4. New message: `CANCEL_REMIX` with `requestId`

### Phase 3: Popup UI Update
**Files**: `popup.ts`, `popup.css`, `popup.html`

1. Replace single progress section with "Active Remixes" list
2. Each active remix shows: title, recipe icon, status, elapsed time
3. Add cancel button per remix
4. Collapse section when no active remixes
5. Poll for updates or listen to messages

### Phase 4: Badge Update
**Files**: `service-worker.ts`

1. New `updateBadge()` function that reads all active remixes
2. Show count when multiple active
3. Show checkmark briefly on any completion
4. Clear when all done

### Phase 5: Cancel Implementation
**Files**: `service-worker.ts`, `ai-service.ts`

1. Store `AbortController` in memory map by requestId
2. Pass controller to `analyzeWithAI()`
3. Handle `CANCEL_REMIX` message
4. Clean up on cancel

---

## Data Flow (New)

```
Popup                    Service Worker              AI Service
  │                            │                          │
  ├─ AI_ANALYZE ──────────────►│                          │
  │                            ├─ generate requestId      │
  │                            ├─ store in activeRemixes  │
  │◄─ {requestId} ─────────────┤                          │
  │                            ├─ analyzeWithAI() ───────►│
  │                            │                          │
  │◄─ PROGRESS_UPDATE {id} ────┤ (periodic)               │
  │                            │                          │
  │                            │◄─ response ──────────────┤
  │                            ├─ save article            │
  │◄─ PROGRESS_UPDATE {id} ────┤ (complete)               │
  │                            ├─ cleanup after delay     │
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Memory leak from uncleaned requests | Auto-cleanup completed requests after 10s; cleanup on extension restart |
| Too many concurrent API calls | Optional: limit to 3-5 concurrent remixes |
| Popup closes during multi-remix | Already handled - progress in storage survives |
| Badge flicker with many updates | Debounce badge updates to max 1/second |

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Request ID Infrastructure | 1 hour |
| Phase 2: Message Protocol | 30 min |
| Phase 3: Popup UI | 1.5 hours |
| Phase 4: Badge | 30 min |
| Phase 5: Cancel | 45 min |
| **Total** | **~4-5 hours** |

---

## Future Enhancements

- **Queue system**: If user starts 10 remixes, queue them and run 3 at a time
- **Priority**: Let user reorder queue
- **Retry**: Auto-retry failed remixes with exponential backoff
- **Notifications**: Browser notification when remix completes (if popup closed)
