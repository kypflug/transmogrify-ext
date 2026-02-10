/**
 * OneDrive Service for Cloud Functions
 * 
 * Uploads completed articles to the user's OneDrive approot/articles/ folder
 * using their delegated access token. Writes in the exact same format as the
 * extension's pushArticleToCloud so the sync engine picks them up seamlessly.
 */

import { OneDriveArticleMeta } from './types.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const APP_FOLDER = 'articles';

/**
 * Ensure the articles folder exists in the user's AppData
 */
async function ensureFolder(accessToken: string): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.ok) return;

  if (res.status === 404) {
    const createRes = await fetch(
      `${GRAPH_BASE}/me/drive/special/approot/children`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: APP_FOLDER,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      }
    );
    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(`Failed to create articles folder: ${createRes.statusText}`);
    }
    return;
  }

  if (res.status === 401) {
    throw new Error('Access token expired or invalid — user may need to re-authenticate');
  }

  throw new Error(`Failed to check articles folder: ${res.status} ${res.statusText}`);
}

/**
 * Upload article HTML content to OneDrive
 */
async function uploadContent(accessToken: string, id: string, html: string): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.html:/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'text/html',
      },
      body: html,
    }
  );

  if (!res.ok) {
    throw new Error(`Upload HTML failed (${res.status}): ${res.statusText}`);
  }
}

/**
 * Upload article metadata JSON to OneDrive
 */
async function uploadMeta(accessToken: string, id: string, meta: OneDriveArticleMeta): Promise<void> {
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json:/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(meta, null, 2),
    }
  );

  if (!res.ok) {
    throw new Error(`Upload metadata failed (${res.status}): ${res.statusText}`);
  }
}

/**
 * Upload a completed article to the user's OneDrive
 * Writes both .html and .json in the same format as the extension
 */
export async function uploadArticleToUserDrive(
  accessToken: string,
  articleId: string,
  html: string,
  meta: OneDriveArticleMeta,
): Promise<void> {
  await ensureFolder(accessToken);
  await Promise.all([
    uploadContent(accessToken, articleId, html),
    uploadMeta(accessToken, articleId, meta),
  ]);
}

/**
 * Validate that the access token has the required scopes
 * by making a lightweight call to Graph
 */
export async function validateToken(accessToken: string): Promise<{ valid: boolean; userId?: string; error?: string }> {
  try {
    const res = await fetch(`${GRAPH_BASE}/me?$select=id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.ok) {
      const data = await res.json() as { id: string };
      return { valid: true, userId: data.id };
    }

    if (res.status === 401) {
      return { valid: false, error: 'Token expired or invalid' };
    }

    return { valid: false, error: `Graph API error: ${res.status}` };
  } catch (err) {
    return { valid: false, error: `Token validation failed: ${err}` };
  }
}
