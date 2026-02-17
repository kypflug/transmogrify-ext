/**
 * OneDrive Service for Transmogrifier
 * Manages article storage in OneDrive AppData via Microsoft Graph API
 * 
 * Storage layout:
 *   /drive/special/approot/articles/{id}.html  — full article content
 *   /drive/special/approot/articles/{id}.json  — article metadata
 */

import { getAccessToken } from './auth-service';
import type { OneDriveImageAsset } from '@kypflug/transmogrifier-core';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const APP_FOLDER = 'articles';
const IMAGE_FOLDER = 'images';

// Delta token persistence key
const DELTA_TOKEN_KEY = 'onedrive_delta_token';

export interface OneDriveArticleMeta {
  id: string;
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
  size: number;
  images?: OneDriveImageAsset[];
  // Sharing fields (optional)
  sharedUrl?: string;
  sharedBlobUrl?: string;
  shareShortCode?: string;
  sharedAt?: number;
  shareExpiresAt?: number;
}

export interface DeltaResult {
  /** New or updated article metadata */
  upserted: OneDriveArticleMeta[];
  /** IDs of deleted articles */
  deleted: string[];
  /** New delta token for next call */
  deltaToken: string;
  /** True when the result is a full listing (delta token expired/missing).
   *  Consumers should REPLACE the cloud index rather than merge. */
  isFullResync: boolean;
  /** True when one or more metadata downloads failed during the delta.
   *  Consumers should NOT trust the upserted list as complete. */
  hasDownloadFailures: boolean;
}

interface DeltaItem {
  name?: string;
  deleted?: { state: string };
  '@microsoft.graph.downloadUrl'?: string;
  '@removed'?: { reason: string };
  [key: string]: unknown;
}

/**
 * Get an authenticated headers object, or throw if not signed in
 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in to Microsoft account');
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Ensure the articles folder exists in AppData
 */
async function ensureFolder(): Promise<void> {
  const headers = await authHeaders();

  // Try to get the folder — Graph auto-creates approot on first access
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}`,
    { headers, cache: 'no-store' as RequestCache }
  );

  if (res.ok) return;

  if (res.status === 404) {
    // Create the folder
    const createRes = await fetch(
      `${GRAPH_BASE}/me/drive/special/approot/children`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: APP_FOLDER,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
        cache: 'no-store' as RequestCache,
      }
    );

    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(`Failed to create articles folder: ${createRes.statusText}`);
    }
    return;
  }

  throw new Error(`Failed to check articles folder: ${res.statusText}`);
}

async function ensureFolderPath(segments: string[]): Promise<void> {
  const headers = await authHeaders();
  let currentPath = '';

  for (const segment of segments) {
    const targetPath = currentPath ? `${currentPath}/${segment}` : segment;
    const res = await fetch(
      `${GRAPH_BASE}/me/drive/special/approot:/${targetPath}`,
      { headers, cache: 'no-store' as RequestCache }
    );

    if (res.ok) {
      currentPath = targetPath;
      continue;
    }

    if (res.status === 404) {
      const parentPath = currentPath
        ? `${GRAPH_BASE}/me/drive/special/approot:/${currentPath}:/children`
        : `${GRAPH_BASE}/me/drive/special/approot/children`;
      const createRes = await fetch(
        parentPath,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: segment,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          }),
          cache: 'no-store' as RequestCache,
        }
      );

      if (!createRes.ok && createRes.status !== 409) {
        throw new Error(`Failed to create folder ${targetPath}: ${createRes.statusText}`);
      }
      currentPath = targetPath;
      continue;
    }

    throw new Error(`Failed to check folder ${targetPath}: ${res.statusText}`);
  }
}

export async function ensureArticleImagesFolder(articleId: string): Promise<void> {
  await ensureFolderPath([APP_FOLDER, articleId, IMAGE_FOLDER]);
}

export async function uploadBinaryToAppPath(
  drivePath: string,
  data: Blob,
  contentType: string,
): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${drivePath}:/content`,
    {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': contentType,
      },
      body: data,
      cache: 'no-store' as RequestCache,
    }
  );

  if (!res.ok) {
    throw new Error(`Upload binary failed (${res.status}): ${res.statusText}`);
  }
}

/**
 * Upload article HTML content to OneDrive
 */
export async function uploadArticleContent(id: string, html: string): Promise<void> {
  await ensureFolder();
  const headers = await authHeaders();
  const blob = new Blob([html], { type: 'text/html' });

  // For files < 4MB, use simple upload; for larger, use upload session
  if (blob.size < 4 * 1024 * 1024) {
    const res = await fetch(
      `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.html:/content`,
      {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'text/html',
        },
        body: blob,
        cache: 'no-store' as RequestCache,
      }
    );

    if (!res.ok) {
      throw new Error(`Upload content failed (${res.status}): ${res.statusText}`);
    }
  } else {
    // Large file upload session
    await uploadLargeFile(headers, `${APP_FOLDER}/${id}.html`, blob);
  }
}

/**
 * Get the ETag for an article's metadata file on OneDrive.
 * Returns null if the file doesn't exist.
 */
export async function getArticleMetaETag(id: string): Promise<string | null> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json`,
    { method: 'GET', headers, cache: 'no-store' as RequestCache }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.eTag || null;
}

/**
 * Upload article metadata JSON to OneDrive.
 * If eTag is provided, uses If-Match for conflict detection.
 * On 412 (Precondition Failed), re-downloads remote meta, merges, and retries once.
 */
export async function uploadArticleMeta(
  id: string,
  meta: OneDriveArticleMeta,
  eTag?: string,
): Promise<void> {
  await ensureFolder();
  const headers = await authHeaders();
  const json = JSON.stringify(meta, null, 2);

  const reqHeaders: Record<string, string> = {
    ...headers,
    'Content-Type': 'application/json',
  };
  if (eTag) {
    reqHeaders['If-Match'] = eTag;
  }

  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json:/content`,
    {
      method: 'PUT',
      headers: reqHeaders,
      body: json,
      cache: 'no-store' as RequestCache,
    }
  );

  if (res.status === 412 && eTag) {
    // Conflict — re-download, merge, retry without ETag (last-write-wins fallback)
    console.warn('[OneDrive] ETag conflict on meta upload, merging:', id);
    try {
      const remoteMeta = await downloadArticleMeta(id);
      const merged: OneDriveArticleMeta = {
        ...remoteMeta,
        ...meta,
        // OR-merge favorites so neither side loses a star
        isFavorite: meta.isFavorite || remoteMeta.isFavorite,
        // Take the latest timestamp
        updatedAt: Math.max(meta.updatedAt, remoteMeta.updatedAt),
      };
      const mergedJson = JSON.stringify(merged, null, 2);
      const retryRes = await fetch(
        `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json:/content`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: mergedJson,
          cache: 'no-store' as RequestCache,
        }
      );
      if (!retryRes.ok) {
        throw new Error(`Merge retry upload failed (${retryRes.status}): ${retryRes.statusText}`);
      }
      console.log('[OneDrive] Merged meta upload succeeded:', id);
    } catch (mergeErr) {
      console.error('[OneDrive] Merge fallback failed, doing unconditional PUT:', mergeErr);
      // Final fallback — unconditional PUT (last-write-wins)
      const fallbackRes = await fetch(
        `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json:/content`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: json,
          cache: 'no-store' as RequestCache,
        }
      );
      if (!fallbackRes.ok) {
        throw new Error(`Fallback upload failed (${fallbackRes.status}): ${fallbackRes.statusText}`);
      }
    }
    return;
  }

  if (!res.ok) {
    throw new Error(`Upload metadata failed (${res.status}): ${res.statusText}`);
  }
}

/**
 * Upload both content and metadata for an article
 */
export async function uploadArticle(
  id: string,
  html: string,
  meta: OneDriveArticleMeta
): Promise<void> {
  // Upload in parallel
  await Promise.all([
    uploadArticleContent(id, html),
    uploadArticleMeta(id, meta),
  ]);
  console.log('[OneDrive] Uploaded article:', id);
}

/**
 * Download article HTML content from OneDrive
 */
export async function downloadArticleContent(id: string): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.html:/content`,
    { headers, cache: 'no-store' as RequestCache }
  );

  if (!res.ok) {
    throw new Error(`Download content failed (${res.status}): ${res.statusText}`);
  }

  return res.text();
}

/**
 * Download article metadata from OneDrive
 */
export async function downloadArticleMeta(id: string): Promise<OneDriveArticleMeta> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json:/content`,
    { headers, cache: 'no-store' as RequestCache }
  );
  if (!res.ok) {
    throw new Error(`Download metadata failed (${res.status}): ${res.statusText}`);
  }

  return res.json();
}

/**
 * Delete article files from OneDrive
 */
export async function deleteRemoteArticle(id: string): Promise<void> {
  const headers = await authHeaders();

  // Delete both files, ignore 404s (already deleted)
  const [htmlRes, jsonRes, folderRes] = await Promise.all([
    fetch(`${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.html`, {
      method: 'DELETE',
      headers,
      cache: 'no-store' as RequestCache,
    }),
    fetch(`${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json`, {
      method: 'DELETE',
      headers,
      cache: 'no-store' as RequestCache,
    }),
    fetch(`${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}`, {
      method: 'DELETE',
      headers,
      cache: 'no-store' as RequestCache,
    }),
  ]);

  if (!htmlRes.ok && htmlRes.status !== 404) {
    throw new Error(`Delete HTML failed: ${htmlRes.statusText}`);
  }
  if (!jsonRes.ok && jsonRes.status !== 404) {
    throw new Error(`Delete JSON failed: ${jsonRes.statusText}`);
  }
  if (!folderRes.ok && folderRes.status !== 404) {
    throw new Error(`Delete folder failed: ${folderRes.statusText}`);
  }

  console.log('[OneDrive] Deleted article:', id);
}

/**
 * List all article metadata files from OneDrive
 * Returns the metadata array and whether any downloads failed.
 */
export async function listRemoteArticles(): Promise<{ metas: OneDriveArticleMeta[]; hasFailures: boolean }> {
  const headers = await authHeaders();
  const metas: OneDriveArticleMeta[] = [];
  let hasFailures = false;

  // Don't use $filter — consumer OneDrive doesn't support it on /children
  let url: string | null = `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}:/children?$select=name&$top=200`;

  while (url) {
    const res = await fetch(url, { headers, cache: 'no-store' as RequestCache });
    if (!res.ok) {
      if (res.status === 404) return { metas: [], hasFailures: false }; // folder doesn't exist yet
      throw new Error(`List articles failed: ${res.statusText}`);
    }

    const data = await res.json();

    // Download each metadata file's content
    for (const item of data.value || []) {
      const name: string = item.name;
      if (!name.endsWith('.json')) continue;
      if (name.startsWith('_')) continue; // skip internal files like _index.json
      const id = name.replace('.json', '');
      try {
        const meta = await downloadArticleMeta(id);
        metas.push(meta);
      } catch {
        console.warn('[OneDrive] Skipping unreadable metadata:', name);
        hasFailures = true;
      }
    }

    url = data['@odata.nextLink'] || null;
  }

  return { metas, hasFailures };
}

/**
 * Get changed files since last sync using delta API
 */
export async function getDelta(): Promise<DeltaResult> {
  const headers = await authHeaders();
  const stored = await chrome.storage.local.get(DELTA_TOKEN_KEY);
  const savedToken = stored[DELTA_TOKEN_KEY] as string | undefined;

  // Use saved delta token, or start fresh
  let url: string;
  if (savedToken) {
    url = savedToken;
  } else {
    url = `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}:/delta`;
  }

  const upserted: OneDriveArticleMeta[] = [];
  const deleted: string[] = [];
  let newDeltaToken = '';
  let hasDownloadFailures = false;

  // Follow pagination
  while (url) {
    const res = await fetch(url, { headers, cache: 'no-store' as RequestCache });

    if (!res.ok) {
      if (res.status === 404 || res.status === 410) {
        // Folder gone or delta token expired — do a full resync
        await chrome.storage.local.remove(DELTA_TOKEN_KEY);
        const listing = await listRemoteArticles();
        return { upserted: listing.metas, deleted: [], deltaToken: '', isFullResync: true, hasDownloadFailures: listing.hasFailures };
      }
      throw new Error(`Delta failed (${res.status}): ${res.statusText}`);
    }

    const data = await res.json();

    for (const item of (data.value || []) as DeltaItem[]) {
      const name: string = item.name || '';

      if (item.deleted || item['@removed']) {
        // Deleted items may lack a name — extract ID from whatever we have
        if (name.startsWith('_')) continue; // skip internal files like _index.json
        if (name.endsWith('.json')) {
          deleted.push(name.replace('.json', ''));
        } else if (name.endsWith('.html')) {
          deleted.push(name.replace('.html', ''));
        }
        // If name is empty, we can't determine the article ID — skip
        // (the reconciliation step in pullFromCloud will catch these)
      } else {
        // Only process .json metadata files for upserts
        if (!name.endsWith('.json')) continue;
        if (name.startsWith('_')) continue; // skip internal files like _index.json

        const id = name.replace('.json', '');
        // Use @microsoft.graph.downloadUrl if available (avoids extra API call)
        const directUrl = item['@microsoft.graph.downloadUrl'];
        try {
          let meta: OneDriveArticleMeta;
          if (directUrl) {
            const res = await fetch(directUrl, { cache: 'no-store' as RequestCache });
            if (!res.ok) throw new Error(`Direct download failed: ${res.status}`);
            meta = await res.json();
          } else {
            meta = await downloadArticleMeta(id);
          }
          upserted.push(meta);
        } catch {
          console.warn('[OneDrive] Skipping delta item:', name);
          hasDownloadFailures = true;
        }
      }
    }

    // Next page or delta link
    if (data['@odata.nextLink']) {
      url = data['@odata.nextLink'];
    } else {
      newDeltaToken = data['@odata.deltaLink'] || '';
      url = '';
    }
  }

  // Persist the new delta token (only if all downloads succeeded)
  if (newDeltaToken && !hasDownloadFailures) {
    await chrome.storage.local.set({ [DELTA_TOKEN_KEY]: newDeltaToken });
  } else if (hasDownloadFailures) {
    console.warn('[OneDrive] Delta token not saved — metadata download(s) failed; will retry next sync');
  }

  return { upserted, deleted, deltaToken: newDeltaToken, isFullResync: !savedToken, hasDownloadFailures };
}

/**
 * Clear the stored delta token (forces full resync on next delta call)
 */
export async function resetDeltaToken(): Promise<void> {
  await chrome.storage.local.remove(DELTA_TOKEN_KEY);
}

// ─── Large File Upload (>4MB) ────────────────────────

async function uploadLargeFile(
  headers: Record<string, string>,
  path: string,
  blob: Blob
): Promise<void> {
  // Create upload session
  const sessionRes = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${path}:/createUploadSession`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: { '@microsoft.graph.conflictBehavior': 'replace' },
      }),
      cache: 'no-store' as RequestCache,
    }
  );

  if (!sessionRes.ok) {
    throw new Error(`Create upload session failed: ${sessionRes.statusText}`);
  }

  const session = await sessionRes.json();
  const uploadUrl = session.uploadUrl;

  // Upload in 4MB chunks
  const chunkSize = 4 * 1024 * 1024;
  const totalSize = blob.size;
  let offset = 0;

  while (offset < totalSize) {
    const end = Math.min(offset + chunkSize, totalSize);
    const chunk = blob.slice(offset, end);

    const chunkRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(end - offset),
        'Content-Range': `bytes ${offset}-${end - 1}/${totalSize}`,
      },
      body: chunk,
    });

    if (!chunkRes.ok && chunkRes.status !== 202) {
      throw new Error(`Chunk upload failed at ${offset}: ${chunkRes.statusText}`);
    }

    offset = end;
  }
}

// ─── Settings Sync ────────────────

const SETTINGS_FILE = 'settings.enc.json';

/**
 * Upload encrypted settings to OneDrive.
 * Stored at /drive/special/approot/settings.enc.json (outside the articles folder).
 */
export async function uploadSettings(encryptedJson: string): Promise<void> {
  const headers = await authHeaders();

  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${SETTINGS_FILE}:/content`,
    {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: encryptedJson,
      cache: 'no-store' as RequestCache,
    }
  );

  if (!res.ok) {
    throw new Error(`Upload settings failed (${res.status}): ${res.statusText}`);
  }

  console.log('[OneDrive] Settings uploaded');
}

/**
 * Download encrypted settings from OneDrive.
 * Returns null if the file doesn't exist.
 */
export async function downloadSettings(): Promise<string | null> {
  const headers = await authHeaders();

  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${SETTINGS_FILE}:/content`,
    { headers, cache: 'no-store' as RequestCache }
  );

  if (res.status === 404) {
    console.log('[OneDrive] No settings file found in cloud');
    return null;
  }

  if (!res.ok) {
    throw new Error(`Download settings failed (${res.status}): ${res.statusText}`);
  }

  return res.text();
}

/**
 * Download a stored asset from OneDrive.
 */
export async function downloadArticleAsset(drivePath: string): Promise<Blob> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${drivePath}:/content`,
    { headers, cache: 'no-store' as RequestCache }
  );

  if (!res.ok) {
    throw new Error(`Download asset failed (${res.status}): ${res.statusText}`);
  }

  return res.blob();
}
