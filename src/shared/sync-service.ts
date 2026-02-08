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
import {
  saveArticle,
  getArticle,
  getAllArticles,
  deleteArticle as localDelete,
  type SavedArticle,
  type ArticleSummary,
} from './storage-service';

// Sync state persistence
const SYNC_STATE_KEY = 'syncState';
const SYNC_INDEX_KEY = 'syncArticleIndex'; // cloud-only article metadata cache

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

// ─── Push Operations (local → cloud) ────────────────

/**
 * Push a newly saved article to OneDrive (fire-and-forget in background)
 */
export async function pushArticleToCloud(article: SavedArticle): Promise<void> {
  if (!(await isSignedIn())) return;

  try {
    const meta: OneDriveArticleMeta = {
      id: article.id,
      title: article.title,
      originalUrl: article.originalUrl,
      recipeId: article.recipeId,
      recipeName: article.recipeName,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      isFavorite: article.isFavorite,
      size: article.size,
    };

    await uploadArticle(article.id, article.html, meta);

    // Update cloud index
    const index = await getCloudIndex();
    const existing = index.findIndex(a => a.id === article.id);
    if (existing >= 0) {
      index[existing] = meta;
    } else {
      index.push(meta);
    }
    await setCloudIndex(index);

    console.log('[Sync] Pushed article to cloud:', article.id);
  } catch (err) {
    console.error('[Sync] Failed to push article to cloud:', err);
    // Non-blocking — article is saved locally regardless
  }
}

/**
 * Push a delete to OneDrive
 */
export async function pushDeleteToCloud(articleId: string): Promise<void> {
  if (!(await isSignedIn())) return;

  try {
    await deleteRemoteArticle(articleId);

    // Remove from cloud index
    const index = await getCloudIndex();
    await setCloudIndex(index.filter(a => a.id !== articleId));

    console.log('[Sync] Pushed delete to cloud:', articleId);
  } catch (err) {
    console.error('[Sync] Failed to push delete to cloud:', err);
  }
}

/**
 * Push a metadata update (favorite toggle, etc.) to OneDrive
 */
export async function pushMetaUpdateToCloud(article: SavedArticle): Promise<void> {
  if (!(await isSignedIn())) return;

  try {
    const meta: OneDriveArticleMeta = {
      id: article.id,
      title: article.title,
      originalUrl: article.originalUrl,
      recipeId: article.recipeId,
      recipeName: article.recipeName,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      isFavorite: article.isFavorite,
      size: article.size,
    };

    // Only re-upload metadata, not content
    const { uploadArticleMeta } = await import('./onedrive-service');
    await uploadArticleMeta(article.id, meta);

    // Update cloud index
    const index = await getCloudIndex();
    const existing = index.findIndex(a => a.id === article.id);
    if (existing >= 0) {
      index[existing] = meta;
    } else {
      index.push(meta);
    }
    await setCloudIndex(index);

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
export async function pullFromCloud(): Promise<{ pulled: number; deleted: number }> {
  if (!(await isSignedIn())) return { pulled: 0, deleted: 0 };

  const state = await getSyncState();
  if (state.isSyncing) {
    console.log('[Sync] Already syncing, skipping');
    return { pulled: 0, deleted: 0 };
  }

  await setSyncState({ isSyncing: true, lastError: undefined });

  try {
    const delta = await getDelta();
    const localArticles = await getAllArticles();
    const localIds = new Set(localArticles.map(a => a.id));
    let pulled = 0;
    let deleted = 0;

    // Process upserts — update cloud index, don't download HTML yet (lazy)
    const cloudIndex = await getCloudIndex();
    const indexMap = new Map(cloudIndex.map(a => [a.id, a]));

    for (const remoteMeta of delta.upserted) {
      indexMap.set(remoteMeta.id, remoteMeta);

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
        // New remote article — add to index but don't download content yet
        pulled++;
      }
    }

    await setCloudIndex(Array.from(indexMap.values()));

    // Process deletes
    for (const deletedId of delta.deleted) {
      indexMap.delete(deletedId);
      if (localIds.has(deletedId)) {
        try {
          await localDelete(deletedId);
          deleted++;
        } catch {
          // ignore
        }
      }
    }

    await setCloudIndex(Array.from(indexMap.values()));
    await setSyncState({ lastSyncTime: Date.now(), isSyncing: false });

    console.log(`[Sync] Pull complete: ${pulled} pulled, ${deleted} deleted`);
    return { pulled, deleted };
  } catch (err) {
    const errorMsg = String(err);
    console.error('[Sync] Pull failed:', errorMsg);
    await setSyncState({ isSyncing: false, lastError: errorMsg });
    return { pulled: 0, deleted: 0 };
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
    console.error('[Sync] Failed to download cloud article:', articleId, err);
    throw err;
  }
}

/**
 * Save or update an article from remote metadata + HTML
 */
async function saveOrUpdateArticle(
  meta: OneDriveArticleMeta,
  html: string
): Promise<SavedArticle> {
  // Check if it already exists
  const existing = await getArticle(meta.id);
  if (existing) {
    // Update in place — we need to use the raw DB operation
    // For now, delete and re-save
    await localDelete(meta.id);
  }

  return saveArticle({
    title: meta.title,
    originalUrl: meta.originalUrl,
    recipeId: meta.recipeId,
    recipeName: meta.recipeName,
    html,
  });
}

/**
 * Get merged article list: local articles + cloud-only articles
 * Cloud-only articles are marked with a flag
 */
export async function getMergedArticleList(): Promise<(ArticleSummary & { cloudOnly?: boolean })[]> {
  const localArticles = await getAllArticles();
  const localIds = new Set(localArticles.map(a => a.id));
  const cloudIndex = await getCloudIndex();

  const merged: (ArticleSummary & { cloudOnly?: boolean })[] = [...localArticles];

  // Add cloud-only articles
  for (const cloud of cloudIndex) {
    if (!localIds.has(cloud.id)) {
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

// ─── Alarm-based Periodic Sync ───────────────────────

const SYNC_ALARM_NAME = 'transmogrifier-sync';

/**
 * Set up periodic sync alarm (call on extension load)
 */
export function setupSyncAlarm(): void {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: 15,
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
      pullFromCloud()
        .then(result => {
          if (result.pulled > 0 || result.deleted > 0) {
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
