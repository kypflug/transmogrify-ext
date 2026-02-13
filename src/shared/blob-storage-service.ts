/**
 * Blob Storage Service for Transmogrifier (BYOS — Bring Your Own Storage)
 *
 * Orchestrates article sharing using pure blob helpers from @kypflug/transmogrifier-core.
 * Platform-specific concerns (auth, settings, OneDrive download) are injected via imports.
 *
 * Flow:
 *  1. Upload article HTML to user's blob container
 *  2. Register short link via cloud function POST /api/share
 *  3. Return branded transmogrifia.app/shared/{code} URL
 */

import { getEffectiveSharingConfig, getEffectiveCloudUrl } from './settings-service';
import { getAccessToken } from './auth-service';
import { downloadArticleAsset } from './onedrive-service';
import {
  type AzureBlobConfig,
  type ShareResult,
  type OneDriveImageAsset,
  uploadHtmlBlob,
  deleteHtmlBlob,
  uploadImageBlob,
  imageBlobUrl,
  deleteImageBlobs,
  validateBlobConfig,
  injectOGTags,
  rewriteTmgAssetUrls,
} from '@kypflug/transmogrifier-core';

export type { AzureBlobConfig, ShareResult } from '@kypflug/transmogrifier-core';

/**
 * Register a short link via the cloud function.
 */
async function registerShortLink(
  resultBlobUrl: string,
  title: string,
  accessToken: string,
  cloudUrl: string,
  expiresAt?: number,
): Promise<{ shortCode: string; shareUrl: string }> {
  const response = await fetch(`${cloudUrl}/api/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blobUrl: resultBlobUrl,
      title,
      accessToken,
      ...(expiresAt ? { expiresAt } : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Share registration failed (${response.status})`);
  }

  return response.json() as Promise<{ shortCode: string; shareUrl: string }>;
}

/**
 * Delete a short link via the cloud function.
 */
async function deleteShortLink(
  shortCode: string,
  accessToken: string,
  cloudUrl: string,
): Promise<void> {
  const response = await fetch(`${cloudUrl}/api/share?code=${shortCode}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // 204 or 404 are both fine
  if (!response.ok && response.status !== 404) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Short link deletion failed (${response.status})`);
  }
}

// ─── Image Blob Sidecar ──────────────────────────────────────────────────────

/** Max images uploaded concurrently to blob storage */
const IMAGE_UPLOAD_CONCURRENCY = 3;

/**
 * Upload article images to blob storage and rewrite tmg-asset: references
 * in the HTML to direct HTTP blob URLs.
 */
async function uploadImagesToBlob(
  html: string,
  articleId: string,
  images: OneDriveImageAsset[],
  config: AzureBlobConfig,
): Promise<string> {
  const assetsById = new Map(images.map(a => [a.id, a]));

  // Find all tmg-asset: references in the HTML
  const tmgPattern = /tmg-asset:([a-f0-9]+)/g;
  const assetIds = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = tmgPattern.exec(html)) !== null) {
    assetIds.add(match[1]);
  }

  if (assetIds.size === 0) return html;

  // Upload images in batches with concurrency control
  const idArray = Array.from(assetIds);
  const urlMap = new Map<string, string>();

  for (let i = 0; i < idArray.length; i += IMAGE_UPLOAD_CONCURRENCY) {
    const batch = idArray.slice(i, i + IMAGE_UPLOAD_CONCURRENCY);
    await Promise.all(batch.map(async (assetId) => {
      const asset = assetsById.get(assetId);
      if (!asset) return;

      try {
        const blob = await downloadArticleAsset(asset.drivePath);
        const fileName = asset.drivePath.split('/').pop() || `${assetId}.bin`;
        await uploadImageBlob(blob, articleId, fileName, asset.contentType || 'application/octet-stream', config);
        urlMap.set(assetId, imageBlobUrl(config, articleId, fileName));
      } catch (err) {
        console.warn(`[Share] Failed to upload image ${assetId}:`, err);
      }
    }));
  }

  return rewriteTmgAssetUrls(html, urlMap);
}

/**
 * Share an article publicly.
 * Uploads HTML to blob storage and registers a short link.
 * If the article has OneDrive image assets, uploads them as separate blobs
 * and rewrites tmg-asset: references to direct HTTP blob URLs.
 *
 * Requires:
 * - BYOS (sharing) config in settings
 * - Signed in (for short link registration)
 */
export async function shareArticle(
  articleId: string,
  html: string,
  title: string,
  expiresAt?: number,
  images?: OneDriveImageAsset[],
): Promise<ShareResult> {
  const config = await getEffectiveSharingConfig();
  if (!config) {
    throw new Error('Sharing not configured. Go to Settings to set up Azure Blob Storage.');
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Sign in to OneDrive to share articles.');
  }

  const cloudUrl = await getEffectiveCloudUrl();

  // 1. Upload image assets to blob storage and rewrite tmg-asset: → HTTP URLs
  let shareHtml = html;
  if (images && images.length > 0) {
    shareHtml = await uploadImagesToBlob(shareHtml, articleId, images, config);
  }

  // 2. Inject OG tags and upload to blob
  const shareUrlPlaceholder = 'https://transmogrifia.app/shared/';
  const htmlWithOG = injectOGTags(shareHtml, title, shareUrlPlaceholder);
  const resultBlobUrl = await uploadHtmlBlob(htmlWithOG, articleId, config);

  // 3. Register short link
  const { shortCode, shareUrl } = await registerShortLink(
    resultBlobUrl,
    title,
    accessToken,
    cloudUrl,
    expiresAt,
  );

  return { shareUrl, blobUrl: resultBlobUrl, shortCode };
}

/**
 * Unshare an article.
 * Deletes the blob, image blobs, and the short link.
 */
export async function unshareArticle(
  articleId: string,
  shortCode: string,
): Promise<void> {
  const config = await getEffectiveSharingConfig();
  const accessToken = await getAccessToken();
  const cloudUrl = await getEffectiveCloudUrl();

  // Delete both in parallel — best effort
  const promises: Promise<void>[] = [];

  if (config) {
    promises.push(deleteHtmlBlob(articleId, config));
    promises.push(deleteImageBlobs(articleId, config));
  }

  if (accessToken && shortCode) {
    promises.push(deleteShortLink(shortCode, accessToken, cloudUrl));
  }

  await Promise.allSettled(promises);
}

/**
 * Validate the sharing configuration by checking if the container is accessible.
 */
export async function validateSharingConfig(config: AzureBlobConfig): Promise<{ valid: boolean; error?: string }> {
  return validateBlobConfig(config);
}
