/**
 * Share Registry — Azure Table Storage backend for URL shortener
 *
 * Maps short codes to blob storage URLs for shared articles.
 * Uses the existing AzureWebJobsStorage connection (same account as the queue).
 *
 * Table: sharedlinks
 *   PartitionKey: "link"
 *   RowKey: <10-char alphanumeric short code>
 *   blobUrl: full blob URL
 *   title: article title (for OG previews)
 *   userId: Graph user ID (for authorization on delete)
 *   createdAt: epoch ms
 *   expiresAt?: epoch ms (optional)
 */

import { TableClient, TableEntity } from '@azure/data-tables';

const TABLE_NAME = 'sharedlinks';
const PARTITION_KEY = 'link';

interface SharedLinkEntity extends TableEntity {
  partitionKey: string;
  rowKey: string;
  blobUrl: string;
  title: string;
  userId: string;
  createdAt: number;
  expiresAt?: number;
  description?: string;
  originalUrl?: string;
  image?: string;
}

export interface SharedLinkRecord {
  shortCode: string;
  blobUrl: string;
  title: string;
  userId: string;
  createdAt: number;
  expiresAt?: number;
  description?: string;
  originalUrl?: string;
  image?: string;
}

let tableClient: TableClient | null = null;

function getTableClient(): TableClient {
  if (tableClient) return tableClient;
  const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
  tableClient = TableClient.fromConnectionString(connectionString, TABLE_NAME);
  return tableClient;
}

/**
 * Generate a 10-character alphanumeric short code.
 * ~36^10 ≈ 3.6 quadrillion combinations — collision is practically impossible.
 */
function generateShortCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

/**
 * Create a new short link mapping.
 * Returns the generated short code.
 */
export async function createShortLink(
  blobUrl: string,
  title: string,
  userId: string,
  expiresAt?: number,
  meta?: { description?: string; originalUrl?: string; image?: string },
): Promise<string> {
  const client = getTableClient();
  await client.createTable(); // no-op if exists

  const shortCode = generateShortCode();

  const entity: SharedLinkEntity = {
    partitionKey: PARTITION_KEY,
    rowKey: shortCode,
    blobUrl,
    title,
    userId,
    createdAt: Date.now(),
    ...(expiresAt ? { expiresAt } : {}),
    ...(meta?.description ? { description: meta.description } : {}),
    ...(meta?.originalUrl ? { originalUrl: meta.originalUrl } : {}),
    ...(meta?.image ? { image: meta.image } : {}),
  };

  await client.createEntity(entity);
  return shortCode;
}

/**
 * Resolve a short code to its blob URL and title.
 * Returns null if not found or expired.
 */
export async function resolveShortLink(
  shortCode: string,
): Promise<SharedLinkRecord | null> {
  const client = getTableClient();

  try {
    const entity = await client.getEntity<SharedLinkEntity>(PARTITION_KEY, shortCode);

    // Check expiration
    if (entity.expiresAt && entity.expiresAt < Date.now()) {
      // Expired — clean up asynchronously and return null
      client.deleteEntity(PARTITION_KEY, shortCode).catch(() => {});
      return null;
    }

    return {
      shortCode,
      blobUrl: entity.blobUrl as string,
      title: entity.title as string,
      userId: entity.userId as string,
      createdAt: entity.createdAt as number,
      ...(entity.expiresAt ? { expiresAt: entity.expiresAt as number } : {}),
      ...(entity.description ? { description: entity.description as string } : {}),
      ...(entity.originalUrl ? { originalUrl: entity.originalUrl as string } : {}),
      ...(entity.image ? { image: entity.image as string } : {}),
    };
  } catch (err: unknown) {
    // 404 = not found
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Delete a short link. Validates that the requesting user owns it.
 * Returns true if deleted, false if not found or not authorized.
 */
export async function deleteShortLink(
  shortCode: string,
  userId: string,
): Promise<{ deleted: boolean; error?: string }> {
  const client = getTableClient();

  try {
    const entity = await client.getEntity<SharedLinkEntity>(PARTITION_KEY, shortCode);

    if (entity.userId !== userId) {
      return { deleted: false, error: 'Not authorized — you can only delete your own shared links' };
    }

    await client.deleteEntity(PARTITION_KEY, shortCode);
    return { deleted: true };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
      return { deleted: false, error: 'Link not found' };
    }
    throw err;
  }
}
