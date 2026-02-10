/**
 * IndexedDB Storage Service for Transmogrifier
 * Stores transmogrified pages with no size limits and full persistence
 */

const DB_NAME = 'TransmogrifierDB';
const OLD_DB_NAME = 'FocusRemixDB'; // Previous name, for migration
const DB_VERSION = 1;
const STORE_NAME = 'articles';

export interface SavedArticle {
  id: string;
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  html: string;
  originalContent?: string; // Original extracted content for respins
  thumbnail?: string; // Small preview image (data URL)
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
  size: number; // HTML size in bytes
  // Sharing fields (optional — set when article is shared publicly)
  sharedUrl?: string;      // Branded transmogrifia.app/shared/{code} URL
  sharedBlobUrl?: string;  // Raw blob storage URL (for deletion)
  shareShortCode?: string; // Short code (for unsharing via cloud API)
  sharedAt?: number;       // When the article was shared (epoch ms)
  shareExpiresAt?: number; // Optional expiration (epoch ms)
}

export interface ArticleSummary {
  id: string;
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  thumbnail?: string;
  createdAt: number;
  isFavorite: boolean;
  size: number;
}

let dbInstance: IDBDatabase | null = null;

/**
 * Open/create the IndexedDB database
 */
async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[Storage] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      // Trigger one-time migration from old DB name (async, non-blocking)
      migrateFromOldDB().then(() => resolve(dbInstance!)).catch(() => resolve(dbInstance!));
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create articles store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        
        // Indexes for querying
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('originalUrl', 'originalUrl', { unique: false });
        store.createIndex('isFavorite', 'isFavorite', { unique: false });
        store.createIndex('recipeId', 'recipeId', { unique: false });
        
        console.log('[Storage] Database schema created');
      }
    };
  });
}

/**
 * Generate a unique ID for articles
 */
function generateId(): string {
  return `article_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

let migrationDone = false;

/**
 * Migrate articles from the old FocusRemixDB to TransmogrifierDB.
 * This is a one-time operation — after copying, the old DB is deleted.
 */
async function migrateFromOldDB(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;

  // Check if old database exists by trying to open it
  return new Promise((resolve) => {
    const openReq = indexedDB.open(OLD_DB_NAME, 1);

    openReq.onerror = () => {
      // Old DB doesn't exist or can't be opened — nothing to migrate
      resolve();
    };

    openReq.onsuccess = () => {
      const oldDb = openReq.result;

      // If the old DB has no articles store, nothing to migrate
      if (!oldDb.objectStoreNames.contains(STORE_NAME)) {
        oldDb.close();
        indexedDB.deleteDatabase(OLD_DB_NAME);
        resolve();
        return;
      }

      // Read all articles from old DB
      const tx = oldDb.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getAllReq = store.getAll();

      getAllReq.onsuccess = async () => {
        const articles: SavedArticle[] = getAllReq.result || [];
        oldDb.close();

        if (articles.length === 0) {
          indexedDB.deleteDatabase(OLD_DB_NAME);
          resolve();
          return;
        }

        console.log(`[Storage] Migrating ${articles.length} articles from ${OLD_DB_NAME}...`);

        try {
          // Write all articles to the new DB
          const newDb = await getDB();
          const writeTx = newDb.transaction([STORE_NAME], 'readwrite');
          const writeStore = writeTx.objectStore(STORE_NAME);

          for (const article of articles) {
            // Use put (not add) so duplicates are handled gracefully
            writeStore.put(article);
          }

          await new Promise<void>((res, rej) => {
            writeTx.oncomplete = () => res();
            writeTx.onerror = () => rej(writeTx.error);
          });

          console.log(`[Storage] Migration complete — ${articles.length} articles restored`);

          // Delete old database now that data is safely copied
          indexedDB.deleteDatabase(OLD_DB_NAME);
          console.log(`[Storage] Old database ${OLD_DB_NAME} removed`);
        } catch (err) {
          console.error('[Storage] Migration failed (old data preserved):', err);
          // Don't delete old DB if migration failed
        }

        resolve();
      };

      getAllReq.onerror = () => {
        console.error('[Storage] Failed to read old database:', getAllReq.error);
        oldDb.close();
        resolve();
      };
    };

    // If the old DB needs an upgrade, it was never properly created — skip
    openReq.onupgradeneeded = () => {
      // Abort — this means the old DB doesn't actually have our schema
      openReq.transaction?.abort();
      resolve();
    };
  });
}

/**
 * Save a transmogrified article to IndexedDB
 */
export async function saveArticle(data: {
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  html: string;
  originalContent?: string;
  thumbnail?: string;
}): Promise<SavedArticle> {
  const db = await getDB();
  
  const article: SavedArticle = {
    id: generateId(),
    title: data.title,
    originalUrl: data.originalUrl,
    recipeId: data.recipeId,
    recipeName: data.recipeName,
    html: data.html,
    originalContent: data.originalContent,
    thumbnail: data.thumbnail,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isFavorite: false,
    size: new Blob([data.html]).size,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(article);

    request.onsuccess = () => {
      console.log('[Storage] Article saved:', article.id);
      resolve(article);
    };

    request.onerror = () => {
      console.error('[Storage] Failed to save article:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get an article by ID (full content)
 */
export async function getArticle(id: string): Promise<SavedArticle | null> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      console.error('[Storage] Failed to get article:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get all articles (summaries only, no HTML content for performance)
 */
export async function getAllArticles(): Promise<ArticleSummary[]> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const request = index.openCursor(null, 'prev'); // Newest first

    const summaries: ArticleSummary[] = [];

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const article = cursor.value as SavedArticle;
        summaries.push({
          id: article.id,
          title: article.title,
          originalUrl: article.originalUrl,
          recipeId: article.recipeId,
          recipeName: article.recipeName,
          thumbnail: article.thumbnail,
          createdAt: article.createdAt,
          isFavorite: article.isFavorite,
          size: article.size,
        });
        cursor.continue();
      } else {
        resolve(summaries);
      }
    };

    request.onerror = () => {
      console.error('[Storage] Failed to list articles:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete an article
 */
export async function deleteArticle(id: string): Promise<void> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      console.log('[Storage] Article deleted:', id);
      resolve();
    };

    request.onerror = () => {
      console.error('[Storage] Failed to delete article:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Toggle favorite status
 */
export async function toggleFavorite(id: string): Promise<boolean> {
  const db = await getDB();
  const article = await getArticle(id);
  
  if (!article) {
    throw new Error('Article not found');
  }

  article.isFavorite = !article.isFavorite;
  article.updatedAt = Date.now();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(article);

    request.onsuccess = () => {
      resolve(article.isFavorite);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Upsert (insert or update) an article by its ID.
 * Uses store.put() so the article's original ID, timestamps, and metadata are preserved.
 * Used by sync to save remote articles without generating new IDs.
 */
export async function upsertArticle(article: SavedArticle): Promise<SavedArticle> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(article);
    tx.oncomplete = () => resolve(article);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Update article share status.
 * Sets or clears the sharing fields without modifying other article data.
 */
export async function updateArticleShareStatus(
  id: string,
  shareData: {
    sharedUrl?: string;
    sharedBlobUrl?: string;
    shareShortCode?: string;
    sharedAt?: number;
    shareExpiresAt?: number;
  } | null,
): Promise<void> {
  const article = await getArticle(id);
  if (!article) throw new Error('Article not found');

  if (shareData) {
    article.sharedUrl = shareData.sharedUrl;
    article.sharedBlobUrl = shareData.sharedBlobUrl;
    article.shareShortCode = shareData.shareShortCode;
    article.sharedAt = shareData.sharedAt;
    article.shareExpiresAt = shareData.shareExpiresAt;
  } else {
    // Clear share fields
    delete article.sharedUrl;
    delete article.sharedBlobUrl;
    delete article.shareShortCode;
    delete article.sharedAt;
    delete article.shareExpiresAt;
  }

  article.updatedAt = Date.now();

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(article);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{ count: number; totalSize: number }> {
  const articles = await getAllArticles();
  return {
    count: articles.length,
    totalSize: articles.reduce((sum, a) => sum + a.size, 0),
  };
}

/**
 * Clear all articles (danger!)
 */
export async function clearAllArticles(): Promise<void> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      console.log('[Storage] All articles cleared');
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * One-time migration: fix double-escaped Unicode sequences (e.g. literal \u2192)
 * left behind by AI in previously generated articles.
 */
export async function migrateFixUnicodeEscapes(): Promise<number> {
  const MIGRATION_KEY = 'migration_unicode_escapes_done';
  const check = await chrome.storage.local.get(MIGRATION_KEY);
  if (check[MIGRATION_KEY]) return 0;

  const db = await getDB();

  const articles: SavedArticle[] = await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const toFix = articles.filter(a => /\\u[0-9a-fA-F]{4}/.test(a.html));

  if (toFix.length > 0) {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const article of toFix) {
      article.html = article.html.replace(
        /\\u([0-9a-fA-F]{4})/g,
        (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)),
      );
      article.size = new Blob([article.html]).size;
      article.updatedAt = Date.now();
      store.put(article);
    }
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    console.log(`[Storage] Unicode-escape migration: fixed ${toFix.length} article(s)`);
  }

  await chrome.storage.local.set({ [MIGRATION_KEY]: true });
  return toFix.length;
}

/**
 * Export article as downloadable HTML file
 */
export async function exportArticleToFile(id: string): Promise<void> {
  const article = await getArticle(id);
  if (!article) {
    throw new Error('Article not found');
  }

  // Create safe filename
  const safeTitle = article.title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);

  const filename = `transmogrified_${safeTitle}_${article.id}.html`;

  // Trigger download via chrome.downloads API
  const base64Html = btoa(unescape(encodeURIComponent(article.html)));
  const dataUrl = `data:text/html;base64,${base64Html}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename: `Transmogrifier/${filename}`,
    saveAs: true,
  });
}
