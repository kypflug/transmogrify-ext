/**
 * HTTP Triggers: Share and resolve article links
 *
 * POST   /api/share          — create a short link (authenticated)
 * DELETE /api/share?code=xxx — delete a short link (authenticated)
 * OPTIONS /api/share         — CORS preflight
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateToken } from '../shared/onedrive.js';
import { createShortLink, deleteShortLink } from '../shared/share-registry.js';

const ALLOWED_BLOB_PATTERN = /^https:\/\/[a-z0-9]+\.blob\.core\.windows\.net\//;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function handleShare(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') {
    return { status: 204, headers: CORS_HEADERS };
  }

  if (request.method === 'DELETE') {
    return handleUnshare(request, context);
  }

  if (request.method === 'POST') {
    return handleCreateShare(request, context);
  }

  return {
    status: 405,
    headers: CORS_HEADERS,
    jsonBody: { error: 'Method not allowed' },
  };
}

interface ShareRequest {
  blobUrl: string;
  title: string;
  accessToken: string;
  expiresAt?: number;
  description?: string;
  originalUrl?: string;
  image?: string;
}

async function handleCreateShare(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: ShareRequest;
  try {
    body = await request.json() as ShareRequest;
  } catch {
    return {
      status: 400,
      headers: CORS_HEADERS,
      jsonBody: { error: 'Invalid JSON body' },
    };
  }

  if (!body.blobUrl || !body.title || !body.accessToken) {
    return {
      status: 400,
      headers: CORS_HEADERS,
      jsonBody: { error: 'Missing required fields: blobUrl, title, accessToken' },
    };
  }

  // Validate blob URL is actually Azure Blob Storage
  if (!ALLOWED_BLOB_PATTERN.test(body.blobUrl)) {
    return {
      status: 400,
      headers: CORS_HEADERS,
      jsonBody: { error: 'Invalid blobUrl — must be an Azure Blob Storage URL (https://*.blob.core.windows.net/...)' },
    };
  }

  // Validate access token
  const tokenResult = await validateToken(body.accessToken);
  if (!tokenResult.valid || !tokenResult.userId) {
    return {
      status: 401,
      headers: CORS_HEADERS,
      jsonBody: { error: tokenResult.error || 'Invalid access token' },
    };
  }

  try {
    const shortCode = await createShortLink(
      body.blobUrl,
      body.title,
      tokenResult.userId,
      body.expiresAt,
      { description: body.description, originalUrl: body.originalUrl, image: body.image },
    );

    context.log(`Created share link ${shortCode} for user ${tokenResult.userId}`);

    return {
      status: 201,
      headers: CORS_HEADERS,
      jsonBody: {
        shortCode,
        shareUrl: `https://transmogrifia.app/shared/${shortCode}`,
      },
    };
  } catch (err) {
    context.error('Failed to create share link:', err);
    return {
      status: 500,
      headers: CORS_HEADERS,
      jsonBody: { error: 'Failed to create share link' },
    };
  }
}

async function handleUnshare(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const code = request.query.get('code');
  if (!code) {
    return {
      status: 400,
      headers: CORS_HEADERS,
      jsonBody: { error: 'Missing code query parameter' },
    };
  }

  // Get access token from Authorization header
  const authHeader = request.headers.get('authorization');
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    return {
      status: 401,
      headers: CORS_HEADERS,
      jsonBody: { error: 'Missing Authorization header' },
    };
  }

  const tokenResult = await validateToken(accessToken);
  if (!tokenResult.valid || !tokenResult.userId) {
    return {
      status: 401,
      headers: CORS_HEADERS,
      jsonBody: { error: tokenResult.error || 'Invalid access token' },
    };
  }

  try {
    const result = await deleteShortLink(code, tokenResult.userId);

    if (!result.deleted) {
      const status = result.error?.includes('Not authorized') ? 403 : 404;
      return {
        status,
        headers: CORS_HEADERS,
        jsonBody: { error: result.error },
      };
    }

    context.log(`Deleted share link ${code} by user ${tokenResult.userId}`);
    return { status: 204, headers: CORS_HEADERS };
  } catch (err) {
    context.error('Failed to delete share link:', err);
    return {
      status: 500,
      headers: CORS_HEADERS,
      jsonBody: { error: 'Failed to delete share link' },
    };
  }
}

app.http('share', {
  methods: ['POST', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: handleShare,
});
