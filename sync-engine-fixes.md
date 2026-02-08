# Sync Engine Fixes — Detailed Instructions

These are bugs and improvements identified in the sync engine (`sync-service.ts`, `onedrive-service.ts`, `storage-service.ts`, `service-worker.ts`) that need to be addressed to achieve reliable mailbox-style sync across devices.

---

## Bug 1: `saveOrUpdateArticle` generates a new ID — breaks cross-device identity

**Severity: Critical**

**File:** `src/shared/sync-service.ts`, lines 265–282

**Problem:** When a remote article is pulled from OneDrive and saved locally, `saveOrUpdateArticle` calls `saveArticle()` which always calls `generateId()` to create a **new** local ID (e.g. `article_1738973619234_a7bc3ef`). This means:

- The remote article (ID `article_1738900000000_xyz`) gets deleted and re-saved with a **different** ID locally.
- On the next push, it gets uploaded as a **new** article, creating a duplicate in OneDrive.
- This cascades: every sync cycle can multiply articles.
- `createdAt` and `updatedAt` are also reset to `Date.now()`, destroying the original timestamps.
- `isFavorite` is reset to `false`.

**Fix:** Add a `saveArticleWithId` (or `upsertArticle`) function to `storage-service.ts` that accepts a full `SavedArticle` object (including `id`, `createdAt`, `updatedAt`, `isFavorite`) and uses `store.put()` instead of `store.add()`. Then rewrite `saveOrUpdateArticle` to use it:

```typescript
// In storage-service.ts — add this new function:
export async function upsertArticle(article: SavedArticle): Promise<SavedArticle> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(article); // put = insert or update by keyPath (id)
    tx.oncomplete = () => resolve(article);
    tx.onerror = () => reject(tx.error);
  });
}

// In sync-service.ts — rewrite saveOrUpdateArticle:
async function saveOrUpdateArticle(
  meta: OneDriveArticleMeta,
  html: string
): Promise<SavedArticle> {
  const existing = await getArticle(meta.id);
  
  const article: SavedArticle = {
    id: meta.id,                    // preserve original ID
    title: meta.title,
    originalUrl: meta.originalUrl,
    recipeId: meta.recipeId,
    recipeName: meta.recipeName,
    html,
    originalContent: existing?.originalContent, // preserve if we had it
    thumbnail: existing?.thumbnail,
    createdAt: meta.createdAt,      // preserve original timestamp
    updatedAt: meta.updatedAt,      // preserve remote timestamp
    isFavorite: meta.isFavorite,    // preserve favorite state
    size: meta.size,
  };

  return upsertArticle(article);
}
```

---

## Bug 2: Pull counter inflated — counts cloud-only as "pulled" without downloading

**Severity: Low**

**File:** `src/shared/sync-service.ts`, lines 186–203

**Problem:** In `pullFromCloud`, when a remote article is new (not in `localIds`), the code increments `pulled++` but does **not** actually download the article content. The article only exists in the cloud index. This makes the pull count misleading and triggers unnecessary `ARTICLES_CHANGED` broadcasts.

**Fix:** Don't increment `pulled` for cloud-index-only additions. Instead, track `newInIndex` separately, or only count articles that were actually downloaded:

```typescript
} else {
  // New remote article — add to index (lazy download on open)
  // Don't count as "pulled" — content not downloaded yet
}
```

---

## Bug 3: `listRemoteArticles` uses `$filter=endswith(...)` which doesn't work on consumer OneDrive

**Severity: Medium**

**File:** `src/shared/onedrive-service.ts`, line 247

**Problem:** The `listRemoteArticles` function (used as fallback when delta token expires) uses `$filter=endswith(name,'.json')` in the OData query. **Consumer OneDrive does not support `$filter` on the `/children` endpoint.** This will return a `400` or silently return all files unfiltered.

**Fix:** Remove the `$filter` from the URL and filter client-side, just like `getDelta` already does:

```typescript
let url: string | null = 
  `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}:/children?$select=name&$top=200`;

// ... then in the loop:
if (!name.endsWith('.json')) continue;
```

---

## Bug 4: Cloud index can go stale / diverge from OneDrive reality

**Severity: Medium**

**File:** `src/shared/sync-service.ts` — cloud index management throughout

**Problem:** The cloud index (`syncArticleIndex` in `chrome.storage.local`) is maintained manually alongside push/pull operations. It can drift from reality because:

1. If a push fails silently (catch swallows error), the cloud index still gets updated as if it succeeded.
2. If the extension is reinstalled or storage is cleared, the cloud index is empty but OneDrive still has articles — and there's no mechanism to rebuild it from a full delta.
3. The delta API returns **file-level** changes (`.json` file changed), but the cloud index stores **parsed metadata**. If a metadata download fails during delta, the index misses the update.

**Fix:** The cloud index should be **rebuilt from delta results** rather than manually maintained alongside pushes:

- During `pullFromCloud`, rebuild the cloud index entirely from the delta response + existing index, rather than surgically inserting entries during push operations.
- On push, **don't** update the cloud index. Let the next pull/delta discover the change organically.
- Add a "force full sync" option that clears the delta token and cloud index, then does a fresh delta (which returns everything on first call).

---

## Bug 5: No deduplication by `originalUrl` — same page can be transmogrified multiple times across devices

**Severity: Low (design decision)**

**Problem:** If the same page is transmogrified on two different devices before a sync occurs, two separate articles with different IDs are created in OneDrive. This is arguably correct (they may use different recipes or produce different results), but it could surprise users who expect mailbox-style dedup.

**Recommendation:** This is acceptable behavior — keep it as-is. Different transmogrifications of the same URL are distinct articles. But consider showing the source URL in the library to help users identify duplicates.

---

## Bug 6: Favorite toggle on cloud-only articles doesn't work properly

**Severity: Medium**

**File:** `src/shared/sync-service.ts`, `pushMetaUpdateToCloud`

**Problem:** `pushMetaUpdateToCloud` takes a `SavedArticle` (local IndexedDB object), but cloud-only articles don't exist locally — they're only in the cloud index. If a user favorites a cloud-only article in the library, `toggleFavorite` in `storage-service.ts` will throw "Article not found."

**Fix:** The library UI should first download the article (via `downloadCloudArticle`) before allowing metadata operations, OR add a separate code path that updates the cloud index and pushes metadata directly for cloud-only articles.

---

## Improvement 1: Immediate sync notification to other devices

**Current behavior:** Articles sync every 15 minutes via alarm, or on library open. This means a new article created on one device can take up to 15 minutes to appear on another.

**Improvement:** After a successful push (`pushArticleToCloud`), the article is already in OneDrive. The other device just needs to check. Consider:

1. Reducing the alarm interval to 5 minutes
2. Adding a visible "last synced" indicator in the library footer
3. Making the sync button in the library trigger an immediate `pullFromCloud`

The PWA side already handles this with delta sync + manual refresh. The extension should match.

---

## Improvement 2: Don't re-download metadata for every delta item

**File:** `src/shared/onedrive-service.ts`, `getDelta()`, lines 305–312

**Problem:** For every `.json` file in the delta response, the code does a **separate** `downloadArticleMeta(id)` call to fetch the file's contents. This means N delta items = N+1 HTTP requests (1 for delta page + N for metadata downloads). On a first sync with 50 articles, that's 51 serial requests.

**Fix:** The delta API already returns file metadata like `name`, `size`, `lastModifiedDateTime`. You could:

1. Use batch requests (`$batch`) to download multiple metadata files in one call
2. Or, since the delta response includes the file's `@microsoft.graph.downloadUrl` for each item, download content directly from that URL instead of making a separate `/content` request

This would dramatically improve first-sync performance.

---

## Summary of Required Changes

| # | File | Change | Priority |
|---|------|--------|----------|
| 1 | `storage-service.ts` | Add `upsertArticle()` function | Critical |
| 1 | `sync-service.ts` | Rewrite `saveOrUpdateArticle` to preserve ID, timestamps, favorites | Critical |
| 3 | `onedrive-service.ts` | Remove `$filter=endswith` from `listRemoteArticles` | Medium |
| 4 | `sync-service.ts` | Stop updating cloud index on push; rebuild from pull only | Medium |
| 6 | `sync-service.ts` | Handle favorite toggle for cloud-only articles | Medium |
| 2 | `sync-service.ts` | Fix inflated pull counter | Low |
| I1 | `sync-service.ts` | Reduce alarm to 5 min, add last-synced indicator | Low |
| I2 | `onedrive-service.ts` | Optimize delta to avoid N+1 metadata downloads | Low |

**Bug 1 is the most critical** — it's likely the root cause of articles not syncing properly between devices, as pulled articles get new IDs and timestamps, then create duplicates on the next push cycle.
