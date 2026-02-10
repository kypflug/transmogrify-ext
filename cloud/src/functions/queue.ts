/**
 * HTTP Trigger: Queue a URL for transmogrification
 * 
 * POST /api/queue — accepts a URL + recipe + access token, validates the token,
 * enqueues a job, and returns 202 Accepted immediately.
 * 
 * GET /api/queue?jobId=xxx — check job status (stored in table storage)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { QueueClient } from '@azure/storage-queue';
import { TransmogrifyJob, QueueRequest } from '../shared/types.js';
import { validateToken } from '../shared/onedrive.js';
import { RECIPE_NAMES } from '../shared/recipes.js';

const QUEUE_NAME = 'transmogrify-jobs';

function getQueueClient(): QueueClient {
  const connectionString = process.env.AzureWebJobsStorage || 'UseDevelopmentStorage=true';
  return new QueueClient(connectionString, QUEUE_NAME);
}

async function handleQueue(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  // CORS headers for extension/PWA
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  if (request.method === 'GET') {
    return handleStatusCheck(request, context, corsHeaders);
  }

  if (request.method === 'POST') {
    return handleQueueJob(request, context, corsHeaders);
  }

  return {
    status: 405,
    headers: corsHeaders,
    jsonBody: { error: 'Method not allowed' },
  };
}

async function handleQueueJob(
  request: HttpRequest,
  context: InvocationContext,
  corsHeaders: Record<string, string>,
): Promise<HttpResponseInit> {
  let body: QueueRequest;
  try {
    body = await request.json() as QueueRequest;
  } catch {
    return {
      status: 400,
      headers: corsHeaders,
      jsonBody: { error: 'Invalid JSON body' },
    };
  }

  // Validate required fields
  if (!body.url || !body.accessToken) {
    return {
      status: 400,
      headers: corsHeaders,
      jsonBody: { error: 'Missing required fields: url, accessToken' },
    };
  }

  // Validate AI config — server has no AI keys, users must provide their own
  if (!body.aiConfig?.apiKey || !body.aiConfig?.provider) {
    return {
      status: 400,
      headers: corsHeaders,
      jsonBody: { error: 'Missing required field: aiConfig (provider + apiKey). Configure your AI keys in extension Settings.' },
    };
  }

  // Validate URL
  try {
    new URL(body.url);
  } catch {
    return {
      status: 400,
      headers: corsHeaders,
      jsonBody: { error: 'Invalid URL' },
    };
  }

  // Validate recipe
  const recipeId = body.recipeId || 'focus';
  if (!RECIPE_NAMES[recipeId]) {
    return {
      status: 400,
      headers: corsHeaders,
      jsonBody: { error: `Unknown recipe: ${recipeId}. Valid: ${Object.keys(RECIPE_NAMES).join(', ')}` },
    };
  }

  // Validate access token
  const tokenResult = await validateToken(body.accessToken);
  if (!tokenResult.valid) {
    return {
      status: 401,
      headers: corsHeaders,
      jsonBody: { error: tokenResult.error || 'Invalid access token' },
    };
  }

  // Generate job ID
  const jobId = crypto.randomUUID();

  // Build job message
  const job: TransmogrifyJob = {
    jobId,
    url: body.url,
    recipeId,
    customPrompt: body.customPrompt,
    accessToken: body.accessToken,
    aiConfig: body.aiConfig,
    queuedAt: Date.now(),
  };

  // Enqueue
  try {
    const queueClient = getQueueClient();
    await queueClient.createIfNotExists();

    // Base64-encode the message (required by Azure Storage Queue)
    const messageText = Buffer.from(JSON.stringify(job)).toString('base64');
    await queueClient.sendMessage(messageText);

    context.log(`Queued job ${jobId} for ${body.url} (recipe: ${recipeId})`);

    return {
      status: 202,
      headers: corsHeaders,
      jsonBody: {
        jobId,
        message: 'Queued for transmogrification',
        recipe: recipeId,
        recipeName: RECIPE_NAMES[recipeId],
      },
    };
  } catch (err) {
    context.error('Failed to enqueue job:', err);
    return {
      status: 500,
      headers: corsHeaders,
      jsonBody: { error: 'Failed to queue job' },
    };
  }
}

async function handleStatusCheck(
  request: HttpRequest,
  _context: InvocationContext,
  corsHeaders: Record<string, string>,
): Promise<HttpResponseInit> {
  const jobId = request.query.get('jobId');
  if (!jobId) {
    return {
      status: 400,
      headers: corsHeaders,
      jsonBody: { error: 'Missing jobId query parameter' },
    };
  }

  // For now, status is fire-and-forget — the article appears in OneDrive.
  // A future enhancement could store job status in Table Storage.
  return {
    status: 200,
    headers: corsHeaders,
    jsonBody: {
      jobId,
      status: 'unknown',
      message: 'Job status tracking not yet implemented. Check your OneDrive sync for the result.',
    },
  };
}

app.http('queue', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: handleQueue,
});
