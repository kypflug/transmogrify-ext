import type { OneDriveImageAsset } from '@kypflug/transmogrifier-core';
import { ensureArticleImagesFolder, uploadBinaryToAppPath, downloadArticleAsset } from './onedrive-service';

const IMAGE_ATTR_ID = 'data-tmg-asset-id';
const IMAGE_ATTR_SRC = 'data-tmg-asset-src';

export interface PersistedImagesResult {
  html: string;
  images: OneDriveImageAsset[];
}

export async function persistArticleImages(
  articleId: string,
  html: string,
  baseUrl?: string,
): Promise<PersistedImagesResult> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const images = Array.from(doc.querySelectorAll('img')) as HTMLImageElement[];
  if (images.length === 0) return { html, images: [] };

  await ensureArticleImagesFolder(articleId);

  const assets: OneDriveImageAsset[] = [];
  const assetByHash = new Map<string, OneDriveImageAsset>();

  for (const img of images) {
    const src = img.getAttribute('src')?.trim();
    if (!src) continue;
    if (src.startsWith('tmg-asset:') || src.startsWith('blob:')) continue;

    const resolvedUrl = resolveImageUrl(src, baseUrl);
    if (!resolvedUrl && !src.startsWith('data:')) continue;

    const imageData = await fetchImageData(resolvedUrl || src);
    if (!imageData) continue;

    const hash = await hashBytes(imageData.bytes);
    const existing = assetByHash.get(hash);

    let asset: OneDriveImageAsset;
    if (existing) {
      asset = existing;
    } else {
      const extension = getExtensionForContentType(imageData.contentType, resolvedUrl || src);
      const assetId = hash;
      const fileName = extension ? `${assetId}.${extension}` : assetId;
      const drivePath = `articles/${articleId}/images/${fileName}`;

      await uploadBinaryToAppPath(
        drivePath,
        new Blob([toArrayBuffer(imageData.bytes)], { type: imageData.contentType }),
        imageData.contentType,
      );

      const isDataUrl = src.startsWith('data:');
      asset = {
        id: assetId,
        originalUrl: isDataUrl ? '' : (resolvedUrl || src),
        drivePath,
        contentType: imageData.contentType,
        bytes: imageData.bytes.length,
        source: isDataUrl ? 'ai' : 'original',
      };

      assetByHash.set(hash, asset);
      assets.push(asset);
    }

    img.setAttribute(IMAGE_ATTR_ID, asset.id);
    if (asset.originalUrl) {
      img.setAttribute(IMAGE_ATTR_SRC, asset.originalUrl);
    }
  }

  return { html: serializeDocument(html, doc), images: assets };
}

export async function resolveArticleImages(
  html: string,
  images?: OneDriveImageAsset[],
): Promise<{ html: string; blobUrls: string[] }> {
  if (!images || images.length === 0) return { html, blobUrls: [] };

  const assetsById = new Map(images.map(asset => [asset.id, asset]));
  const assetsBySrc = new Map(
    images
      .filter(asset => asset.originalUrl)
      .map(asset => [asset.originalUrl as string, asset]),
  );

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imageElements = Array.from(doc.querySelectorAll('img')) as HTMLImageElement[];
  const blobUrls: string[] = [];

  await Promise.all(imageElements.map(async (img) => {
    const asset = findImageAsset(img, assetsById, assetsBySrc);
    if (!asset) return;

    try {
      const blob = await downloadArticleAsset(asset.drivePath);
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push(blobUrl);
      img.setAttribute('src', blobUrl);
      img.setAttribute(IMAGE_ATTR_ID, asset.id);
    } catch (err) {
      console.warn('[Images] Failed to resolve asset:', asset.drivePath, err);
    }
  }));

  return { html: serializeDocument(html, doc), blobUrls };
}

function findImageAsset(
  img: HTMLImageElement,
  assetsById: Map<string, OneDriveImageAsset>,
  assetsBySrc: Map<string, OneDriveImageAsset>,
): OneDriveImageAsset | undefined {
  const assetId = img.getAttribute(IMAGE_ATTR_ID);
  if (assetId && assetsById.has(assetId)) return assetsById.get(assetId);

  const src = img.getAttribute('src');
  if (src && assetsBySrc.has(src)) return assetsBySrc.get(src);

  const originalSrc = img.getAttribute(IMAGE_ATTR_SRC);
  if (originalSrc && assetsBySrc.has(originalSrc)) return assetsBySrc.get(originalSrc);

  return undefined;
}

function resolveImageUrl(src: string, baseUrl?: string): string | undefined {
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('data:')) return src;
  if (!baseUrl) return undefined;
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return undefined;
  }
}

async function fetchImageData(src: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (src.startsWith('data:')) {
    return parseDataUrl(src);
  }

  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    return { bytes: new Uint8Array(arrayBuffer), contentType };
  } catch {
    return null;
  }
}

function parseDataUrl(src: string): { bytes: Uint8Array; contentType: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(src);
  if (!match) return null;
  const contentType = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const data = match[3] || '';

  try {
    if (isBase64) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { bytes, contentType };
    }

    const decoded = decodeURIComponent(data);
    const bytes = new TextEncoder().encode(decoded);
    return { bytes, contentType };
  } catch {
    return null;
  }
}

function getExtensionForContentType(contentType: string, fallbackUrl?: string): string | undefined {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/avif':
      return 'avif';
    case 'image/svg+xml':
      return 'svg';
    default:
      break;
  }

  if (fallbackUrl) {
    try {
      const url = new URL(fallbackUrl);
      const path = url.pathname;
      const ext = path.split('.').pop();
      if (ext && ext.length <= 5) return ext.toLowerCase();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function serializeDocument(originalHtml: string, document: Document): string {
  const html = document.documentElement?.outerHTML || originalHtml;
  const trimmed = originalHtml.trimStart();
  if (/^<!doctype/i.test(trimmed)) {
    return `<!DOCTYPE html>\n${html}`;
  }
  return html;
}
