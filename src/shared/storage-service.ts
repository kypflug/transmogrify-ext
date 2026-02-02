/**
 * IndexedDB Storage Service for Focus Remix
 * Stores remixed pages with no size limits and full persistence
 */

const DB_NAME = 'FocusRemixDB';
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
      resolve(dbInstance);
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

/**
 * Save a remixed article to IndexedDB
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

  const filename = `remix_${safeTitle}_${article.id}.html`;

  // Trigger download via chrome.downloads API
  const base64Html = btoa(unescape(encodeURIComponent(article.html)));
  const dataUrl = `data:text/html;base64,${base64Html}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename: `Focus Remix/${filename}`,
    saveAs: true,
  });
}
