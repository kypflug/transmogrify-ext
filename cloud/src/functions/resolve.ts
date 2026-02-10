/**
 * HTTP Trigger: Resolve a shared article short code
 *
 * GET /api/s/{code} — public, no auth required
 *
 * Returns the blob URL and title for client-side rendering.
 * The PWA fetches the blob directly and renders in an iframe.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { resolveShortLink } from '../shared/share-registry.js';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function handleResolve(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  if (request.method === 'OPTIONS') {
    return { status: 204, headers: CORS_HEADERS };
  }

  const code = request.params.code;
  if (!code || !/^[a-z0-9]{6,20}$/i.test(code)) {
    return {
      status: 400,
      headers: CORS_HEADERS,
      jsonBody: { error: 'Invalid short code' },
    };
  }

  try {
    const result = await resolveShortLink(code);

    if (!result) {
      return {
        status: 404,
        headers: {
          ...CORS_HEADERS,
          'Cache-Control': 'no-cache',
        },
        jsonBody: { error: 'Link not found or expired' },
      };
    }

    return {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=3600', // Cache resolved links for 1 hour
      },
      jsonBody: {
        url: result.blobUrl,
        title: result.title,
        ...(result.description ? { description: result.description } : {}),
        ...(result.originalUrl ? { originalUrl: result.originalUrl } : {}),
        ...(result.image ? { image: result.image } : {}),
      },
    };
  } catch (err) {
    return {
      status: 500,
      headers: CORS_HEADERS,
      jsonBody: { error: 'Failed to resolve link' },
    };
  }
}

app.http('resolve', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 's/{code}',
  handler: handleResolve,
});
