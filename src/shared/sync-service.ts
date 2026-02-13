/**
 * Sync Service for Transmogrifier
 * Orchestrates bidirectional sync between local IndexedDB and OneDrive
 * 
 * Strategy:
 * - On save/delete/favorite locally → push to OneDrive in background
 * - Periodically (alarm) + on popup open → pull delta from OneDrive
 * - Lazy content download: metadata syncs immediately, HTML only on open
 * - Conflict resolution: last-write-wins based on updatedAt
 */

import { isSignedIn } from './auth-service';
import {
  uploadArticle,
  deleteRemoteArticle,
  downloadArticleContent,
  getDelta,
  type OneDriveArticleMeta,
} from './onedrive-service';
import { persistArticleImages } from './image-assets';
import {
  getArticle,
  getAllArticles,
  deleteArticle as localDelete,
  upsertArticle,
  type SavedArticle,
  type ArticleSummary,
} from './storage-service';

// Sync state persistence
const SYNC_STATE_KEY = 'syncState';
const SYNC_INDEX_KEY = 'syncArticleIndex'; // cloud-only article metadata cache
const PENDING_DELETES_KEY = 'syncPendingDeletes'; // IDs deleted locally, awaiting delta confirmation

export interface SyncState {
  lastSyncTime: number;
  isSyncing: boolean;
  lastError?: string;
}

/**
 * Get current sync state
 */
export async function getSyncState(): Promise<SyncState> {
  const result = await chrome.storage.local.get(SYNC_STATE_KEY);
  return result[SYNC_STATE_KEY] || { lastSyncTime: 0, isSyncing: false };
}

async function setSyncState(state: Partial<SyncState>): Promise<void> {
  const current = await getSyncState();
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: { ...current, ...state } });
}

/**
 * Get the cloud article index (metadata for articles that exist in OneDrive
 * but may not be downloaded locally yet)
 */
export async function getCloudIndex(): Promise<OneDriveArticleMeta[]> {
  const result = await chrome.storage.local.get(SYNC_INDEX_KEY);
  return result[SYNC_INDEX_KEY] || [];
}

async function setCloudIndex(index: OneDriveArticleMeta[]): Promise<void> {
  await chrome.storage.local.set({ [SYNC_INDEX_KEY]: index });
}

// ─── Pending Deletes ────────────────────────────────
// Tracks article IDs deleted locally so delta upserts don't re-add them.
// Each entry is { id, deletedAt } so we can expire stale entries.

interface PendingDelete { id: string; deletedAt: number; }

async function getRawPendingDeletes(): Promise<PendingDelete[]> {
  const result = await chrome.storage.local.get(PENDING_DELETES_KEY);
  return result[PENDING_DELETES_KEY] || [];
}

async function getPendingDeletes(): Promise<Set<string>> {
  const raw = await getRawPendingDeletes();
  return new Set(raw.map(d => d.id));
}

async function addPendingDelete(articleId: string): Promise<void> {
  const current = await getRawPendingDeletes();
  if (!current.some(d => d.id === articleId)) {
    current.push({ id: articleId, deletedAt: Date.now() });
    await chrome.storage.local.set({ [PENDING_DELETES_KEY]: current });
  }
}

/** Remove confirmed deletes + expire entries older than 7 days */
async function cleanupPendingDeletes(confirmed: Set<string>): Promise<void> {
  const current = await getRawPendingDeletes();
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const filtered = current.filter(
    d => !confirmed.has(d.id) && (now - d.deletedAt) < MAX_AGE_MS
  );
  await chrome.storage.local.set({ [PENDING_DELETES_KEY]: filtered });
}

/**
 * Strip data: URLs from image asset metadata to prevent bloating
 * the cloud index in chrome.storage.local (10 MB quota).
 * AI-generated images embed the full base64 payload in originalUrl;
 * the actual bytes are already persisted at the asset's drivePath.
 */
function sanitizeImageMeta(meta: OneDriveArticleMeta): OneDriveArticleMeta {
  if (!meta.images || meta.images.length === 0) return meta;
  const needsSanitize = meta.images.some(img => img.originalUrl?.startsWith('data:'));
  if (!needsSanitize) return meta;
  return {
    ...meta,
    images: meta.images.map(img => ({
      ...img,
      originalUrl: img.originalUrl?.startsWith('data:') ? '' : img.originalUrl,
    })),
  };
}

// ─── Push Operations (local → cloud) ────────────────

/**
 * Push a newly saved article to OneDrive (fire-and-forget in background)
 */
export async function pushArticleToCloud(article: SavedArticle): Promise<void> {
  if (!(await isSignedIn())) return;

  try {
    let html = article.html;
    let images = article.images;

    if (!images || images.length === 0) {
      try {
        const persisted = await persistArticleImages(article.id, html, article.originalUrl);
        if (persisted.images.length > 0) {
          html = persisted.html;
          images = persisted.images;
          const updatedArticle: SavedArticle = {
            ...article,
            html,
            images,
            size: new Blob([html]).size,
          };
          await upsertArticle(updatedArticle);
        }
      } catch (persistError) {
        console.warn('[Sync] Image persistence failed, continuing without assets:', persistError);
      }
    }

    const meta = sanitizeImageMeta({
      id: article.id,
      title: article.title,
      originalUrl: article.originalUrl,
      recipeId: article.recipeId,
      recipeName: article.recipeName,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      isFavorite: article.isFavorite,
      size: new Blob([html]).size,
      images,
    });

    await uploadArticle(article.id, html, meta);

    // Don't update cloud index on push — let the next pull/delta discover it
    console.log('[Sync] Pushed article to cloud:', article.id);
  } catch (err) {
    console.error('[Sync] Failed to push article to cloud:', err);
    // Non-blocking — article is saved locally regardless
  }
}

/**
 * Prepare a delete for sync: mark as pending-delete and remove from cloud index.
 * This is fast (local storage only) and MUST complete before any UI refresh
 * so getMergedArticleList doesn't re-surface the article.
 */
export async function prepareDeleteForSync(articleId: string): Promise<void> {
  await addPendingDelete(articleId);
  const index = await getCloudIndex();
  await setCloudIndex(index.filter(a => a.id !== articleId));
}

/**
 * Push a delete to OneDrive.
 * Call prepareDeleteForSync first (and await it) before firing this.
 */
export async function pushDeleteToCloud(articleId: string): Promise<void> {
  if (!(await isSignedIn())) return;

  try {
    await deleteRemoteArticle(articleId);
    console.log('[Sync] Pushed delete to cloud:', articleId);
  } catch (err) {
    console.error('[Sync] Failed to push delete to cloud:', err);
    // Cloud index is already cleaned and pending-delete is tracked,
    // so the article won't reappear even if the push failed.
  }
}

/**
 * Push a metadata update (favorite toggle, etc.) to OneDrive
 */
export async function pushMetaUpdateToCloud(article: SavedArticle): Promise<void> {
  if (!(await isSignedIn())) return;

  try {
    const meta = sanitizeImageMeta({
      id: article.id,
      title: article.title,
      originalUrl: article.originalUrl,
      recipeId: article.recipeId,
      recipeName: article.recipeName,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      isFavorite: article.isFavorite,
      size: article.size,
      images: article.images,
    });

    // Only re-upload metadata, not content
    const { uploadArticleMeta } = await import('./onedrive-service');
    await uploadArticleMeta(article.id, meta);

    // Don't update cloud index on push — let the next pull/delta discover it
    console.log('[Sync] Pushed meta update to cloud:', article.id);
  } catch (err) {
    console.error('[Sync] Failed to push meta update to cloud:', err);
  }
}

// ─── Pull Operations (cloud → local) ────────────────

/**
 * Run a full delta sync: pull changes from OneDrive and merge locally
 * Returns the number of articles synced
 */
export async function pullFromCloud(): Promise<{ pulled: number; deleted: number; pushed: number; indexChanged: number }> {
  if (!(await isSignedIn())) return { pulled: 0, deleted: 0, pushed: 0, indexChanged: 0 };

  const state = await getSyncState();
  if (state.isSyncing) {
    console.log('[Sync] Already syncing, skipping');
    return { pulled: 0, deleted: 0, pushed: 0, indexChanged: 0 };
  }

  await setSyncState({ isSyncing: true, lastError: undefined });

  try {
    const delta = await getDelta();
    const localArticles = await getAllArticles();
    const localIds = new Set(localArticles.map(a => a.id));
    let pulled = 0;
    let deleted = 0;
    let indexChanged = 0;

    // Load pending deletes — IDs we've deleted locally that may still appear
    // in the delta due to OneDrive's eventual consistency.
    const pendingDeletes = await getPendingDeletes();

    // Process upserts — update cloud index, don't download HTML yet (lazy)
    const cloudIndex = await getCloudIndex();
    // On a full resync with no download failures, the listing IS the complete
    // truth — start fresh so stale entries don't persist.
    // If there were download failures, MERGE with the existing index to avoid
    // losing entries for articles whose metadata couldn't be fetched.
    const indexMap = (delta.isFullResync && !delta.hasDownloadFailures)
      ? new Map<string, OneDriveArticleMeta>()
      : new Map(cloudIndex.map(a => [a.id, a]));

    for (const remoteMeta of delta.upserted) {
      // Skip articles we've locally deleted — delta may be stale
      if (pendingDeletes.has(remoteMeta.id)) {
        console.log('[Sync] Skipping upsert for pending-delete article:', remoteMeta.id);
        continue;
      }
      indexMap.set(remoteMeta.id, sanitizeImageMeta(remoteMeta));

      // If article exists locally, check for conflict
      if (localIds.has(remoteMeta.id)) {
        const localArticle = await getArticle(remoteMeta.id);
        if (localArticle && remoteMeta.updatedAt > localArticle.updatedAt) {
          // Remote is newer — download and overwrite
          try {
            const html = await downloadArticleContent(remoteMeta.id);
            await saveOrUpdateArticle(remoteMeta, html);
            pulled++;
          } catch (err) {
            console.warn('[Sync] Failed to download newer remote article:', remoteMeta.id, err);
          }
        }
        // If local is newer, we'll push on next save (or we could push now)
      } else {
        // New remote article — add to cloud index only (lazy download on open)
        // Don't count as "pulled" since content isn't downloaded yet
        if (!cloudIndex.find(c => c.id === remoteMeta.id)) {
          indexChanged++;
        }
      }
    }

    await setCloudIndex(Array.from(indexMap.values()));

    // Process deletes
    const confirmedDeletes = new Set<string>();
    for (const deletedId of delta.deleted) {
      // Track cloud-index-only removals for broadcast
      if (!localIds.has(deletedId) && indexMap.has(deletedId)) {
        indexChanged++;
      }
      indexMap.delete(deletedId);
      confirmedDeletes.add(deletedId);
      if (localIds.has(deletedId)) {
        try {
          await localDelete(deletedId);
          deleted++;
        } catch {
          // ignore
        }
      }
    }

    // Also remove any pending deletes from the cloud index (in case they
    // were re-added by a stale full-resync / listRemoteArticles fallback)
    for (const pendingId of pendingDeletes) {
      indexMap.delete(pendingId);
    }

    // On a full resync, confirm pending deletes for articles that are absent
    // from the listing — the remote delete succeeded, so stop tracking them.
    if (delta.isFullResync) {
      const remoteIds = new Set(delta.upserted.map(a => a.id));
      for (const pendingId of pendingDeletes) {
        if (!remoteIds.has(pendingId)) {
          confirmedDeletes.add(pendingId);
        }
      }
    }

    // Expire confirmed + old pending deletes
    await cleanupPendingDeletes(confirmedDeletes);

    // Detect cloud-only articles that vanished during a full resync
    const newIndexIds = new Set(Array.from(indexMap.keys()));
    const oldCloudOnlyIds = cloudIndex.filter(c => !localIds.has(c.id)).map(c => c.id);
    for (const oldId of oldCloudOnlyIds) {
      if (!newIndexIds.has(oldId)) {
        indexChanged++;
      }
    }

    await setCloudIndex(Array.from(indexMap.values()));
    await setSyncState({ lastSyncTime: Date.now(), isSyncing: false });

    // ─── Reconciliation ───
    // Compare local articles against the cloud index to handle:
    // 1. Remote deletions that the delta missed (e.g. deleted items with no name)
    // 2. Local-only articles that need pushing
    //
    // SAFETY: Only run the remote-deletion half when the cloud index is
    // trustworthy (no download failures during delta). If metadata downloads
    // failed, the cloud index is incomplete and we'd incorrectly delete
    // local articles that are actually still on OneDrive.
    const finalCloudIndex = await getCloudIndex();
    const cloudIds = new Set(finalCloudIndex.map(a => a.id));
    let pushed = 0;

    const canReconcileDeletes = !delta.hasDownloadFailures && finalCloudIndex.length > 0;

    const now = Date.now();
    const FRESH_THRESHOLD_MS = 60_000;
    for (const local of localArticles) {
      if (!cloudIds.has(local.id)) {
        const age = now - local.createdAt;
        if (age > FRESH_THRESHOLD_MS) {
          if (canReconcileDeletes) {
            try {
              await localDelete(local.id);
              deleted++;
              console.log('[Sync] Removed locally — deleted remotely:', local.id);
            } catch (err) {
              console.warn('[Sync] Failed to remove remotely-deleted article:', local.id, err);
            }
          }
          // else: cloud index may be incomplete — don't delete
        } else {
          // Article is very new — assume it's a local create that hasn't been pushed yet
          try {
            const fullArticle = await getArticle(local.id);
            if (fullArticle) {
              await pushArticleToCloud(fullArticle);
              pushed++;
              console.log('[Sync] Reconciled local-only article to cloud:', local.id);
            }
          } catch (err) {
            console.warn('[Sync] Failed to reconcile article:', local.id, err);
          }
        }
      }
    }

    if (!canReconcileDeletes && localArticles.some(l => !cloudIds.has(l.id))) {
      console.warn('[Sync] Skipped remote-deletion reconciliation — cloud index may be incomplete');
    }
    if (pushed > 0) {
      console.log(`[Sync] Reconciliation pushed ${pushed} local-only articles to cloud`);
    }

    console.log(`[Sync] Pull complete: ${pulled} pulled, ${deleted} deleted, ${pushed} reconciled, ${indexChanged} new cloud-only`);
    return { pulled, deleted, pushed, indexChanged };
  } catch (err) {
    const errorMsg = String(err);
    console.error('[Sync] Pull failed:', errorMsg);
    await setSyncState({ isSyncing: false, lastError: errorMsg });
    return { pulled: 0, deleted: 0, pushed: 0, indexChanged: 0 };
  }
}

/**
 * Download a cloud-only article's content on demand (lazy download)
 * Called when user tries to open an article that's in the cloud index but not downloaded
 */
export async function downloadCloudArticle(articleId: string): Promise<SavedArticle | null> {
  const cloudIndex = await getCloudIndex();
  const meta = cloudIndex.find(a => a.id === articleId);
  if (!meta) return null;

  try {
    const html = await downloadArticleContent(articleId);
    const article = await saveOrUpdateArticle(meta, html);
    return article;
  } catch (err) {
    // If the file no longer exists on OneDrive (404), remove the stale
    // cloud index entry so the article stops reappearing.
    const errMsg = String(err);
    if (errMsg.includes('(404)') || errMsg.includes('Not Found')) {
      console.warn('[Sync] Article no longer on OneDrive, removing from cloud index:', articleId);
      await setCloudIndex(cloudIndex.filter(a => a.id !== articleId));
      return null;
    }
    console.error('[Sync] Failed to download cloud article:', articleId, err);
    throw err;
  }
}

/**
 * Save or update an article from remote metadata + HTML.
 * Preserves the original ID, timestamps, and favorite state from the remote.
 */
async function saveOrUpdateArticle(
  meta: OneDriveArticleMeta,
  html: string
): Promise<SavedArticle> {
  const existing = await getArticle(meta.id);

  // Fix double-escaped Unicode sequences from older AI generations (e.g. literal \u2192 → →)
  const cleanHtml = html.replace(
    /\\u([0-9a-fA-F]{4})/g,
    (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)),
  );

  const article: SavedArticle = {
    id: meta.id,
    title: meta.title,
    originalUrl: meta.originalUrl,
    recipeId: meta.recipeId,
    recipeName: meta.recipeName,
    html: cleanHtml,
    originalContent: existing?.originalContent,
    thumbnail: existing?.thumbnail,
    images: meta.images,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    isFavorite: meta.isFavorite,
    size: new Blob([cleanHtml]).size,
  };

  return upsertArticle(article);
}

/**
 * Get merged article list: local articles + cloud-only articles
 * Cloud-only articles are marked with a flag
 */
export async function getMergedArticleList(): Promise<(ArticleSummary & { cloudOnly?: boolean })[]> {
  const localArticles = await getAllArticles();
  const localIds = new Set(localArticles.map(a => a.id));
  const cloudIndex = await getCloudIndex();
  const pendingDeletes = await getPendingDeletes();

  const merged: (ArticleSummary & { cloudOnly?: boolean })[] = [...localArticles];

  // Add cloud-only articles (skip pending deletes)
  for (const cloud of cloudIndex) {
    if (!localIds.has(cloud.id) && !pendingDeletes.has(cloud.id)) {
      merged.push({
        id: cloud.id,
        title: cloud.title,
        originalUrl: cloud.originalUrl,
        recipeId: cloud.recipeId,
        recipeName: cloud.recipeName,
        createdAt: cloud.createdAt,
        isFavorite: cloud.isFavorite,
        size: cloud.size,
        cloudOnly: true,
      });
    }
  }

  // Sort by createdAt descending
  merged.sort((a, b) => b.createdAt - a.createdAt);
  return merged;
}

/**
 * Toggle favorite for a cloud-only article.
 * Downloads it first, toggles the favorite, then pushes the update.
 */
export async function toggleCloudFavorite(articleId: string): Promise<boolean> {
  // Download the article locally first
  const article = await downloadCloudArticle(articleId);
  if (!article) throw new Error('Article not found in cloud index');

  // Now toggle locally (article exists in IndexedDB after download)
  const { toggleFavorite } = await import('./storage-service');
  const newState = await toggleFavorite(articleId);

  // Push updated meta to cloud
  const updated = await getArticle(articleId);
  if (updated) {
    pushMetaUpdateToCloud(updated).catch(() => {});
  }

  return newState;
}

// ─── Alarm-based Periodic Sync ───────────────────────

const SYNC_ALARM_NAME = 'transmogrifier-sync';

/**
 * Set up periodic sync alarm (call on extension load)
 */
export function setupSyncAlarm(): void {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: 5,
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
      pullFromCloud()
        .then(result => {
          if (result.pulled > 0 || result.deleted > 0 || result.pushed > 0 || result.indexChanged > 0) {
            // Notify open library/viewer pages that articles changed
            chrome.runtime.sendMessage({ type: 'ARTICLES_CHANGED', reason: 'sync' }).catch(() => {});
          }
        })
        .catch(err => {
          console.error('[Sync] Periodic sync failed:', err);
        });
    }
  });
}
