/**
 * Queue Trigger: Process a transmogrification job
 * 
 * Picks up jobs from the "transmogrify-jobs" queue and:
 * 1. Fetches the URL and extracts content
 * 2. Calls the AI provider to generate beautiful HTML
 * 3. Uploads the result to the user's OneDrive
 * 
 * The extension (or PWA) picks up the new article on next sync.
 */

import { app, InvocationContext } from '@azure/functions';
import { TransmogrifyJob, OneDriveArticleMeta } from '../shared/types.js';
import { fetchAndExtract } from '../shared/content-extractor.js';
import { generateHTML } from '../shared/ai-service.js';
import { uploadArticleToUserDrive } from '../shared/onedrive.js';
import { RECIPE_NAMES } from '../shared/recipes.js';
import { generateImagesFromPlaceholders, replaceImagePlaceholders, isImageConfigured } from '../shared/image-service.js';

const QUEUE_NAME = 'transmogrify-jobs';

async function processJob(message: unknown, context: InvocationContext): Promise<void> {
  // Parse the job from the queue message
  let job: TransmogrifyJob;
  try {
    if (typeof message === 'string') {
      job = JSON.parse(message);
    } else {
      job = message as TransmogrifyJob;
    }
  } catch (err) {
    context.error('Failed to parse queue message:', err);
    return; // Don't retry — bad message
  }

  const { jobId, url, recipeId, customPrompt, accessToken, aiConfig, imageConfig } = job;
  const startTime = Date.now();
  context.log(`Processing job ${jobId}: ${url} (recipe: ${recipeId})`);

  try {
    // Step 1: Fetch and extract content
    context.log(`[${jobId}] Fetching and extracting content...`);
    const extracted = await fetchAndExtract(url);
    context.log(`[${jobId}] Extracted ${extracted.contentLength} chars: "${extracted.title}"`);

    // Step 2: Generate HTML via AI
    context.log(`[${jobId}] Generating HTML with AI (recipe: ${recipeId})...`);
    const aiResult = await generateHTML(recipeId, extracted.content, customPrompt, aiConfig);
    const aiDuration = Math.round((Date.now() - startTime) / 1000);
    context.log(`[${jobId}] AI generation complete in ${aiDuration}s`);

    if (!aiResult.html) {
      throw new Error('AI returned empty HTML');
    }

    let finalHtml = aiResult.html;

    // Step 2.5: Generate images if the AI returned placeholders and image config is provided
    if (aiResult.images && aiResult.images.length > 0 && isImageConfigured(imageConfig)) {
      context.log(`[${jobId}] Generating ${aiResult.images.length} images (concurrency: 3)...`);
      const imageStart = Date.now();
      try {
        const generatedImages = await generateImagesFromPlaceholders(imageConfig!, aiResult.images);
        const imageDuration = Math.round((Date.now() - imageStart) / 1000);
        context.log(`[${jobId}] Generated ${generatedImages.length}/${aiResult.images.length} images in ${imageDuration}s`);
        finalHtml = replaceImagePlaceholders(finalHtml, generatedImages);
      } catch (imgError) {
        context.warn(`[${jobId}] Image generation failed, continuing without images:`, imgError);
        // Continue with placeholder HTML rather than failing the whole job
      }
    } else if (aiResult.images && aiResult.images.length > 0) {
      context.log(`[${jobId}] AI returned ${aiResult.images.length} image placeholders but no image config provided — skipping image generation`);
    }

    // Step 3: Upload to user's OneDrive
    const articleId = `article_${Date.now()}_${crypto.randomUUID().substring(0, 7)}`;
    const now = Date.now();

    const meta: OneDriveArticleMeta = {
      id: articleId,
      title: extracted.title,
      originalUrl: url,
      recipeId,
      recipeName: RECIPE_NAMES[recipeId] || recipeId,
      createdAt: now,
      updatedAt: now,
      isFavorite: false,
      size: Buffer.byteLength(finalHtml, 'utf-8'),
    };

    context.log(`[${jobId}] Uploading article ${articleId} to OneDrive...`);
    await uploadArticleToUserDrive(accessToken, articleId, finalHtml, meta);

    const totalDuration = Math.round((Date.now() - startTime) / 1000);
    context.log(`[${jobId}] Complete! Article "${extracted.title}" (${articleId}) uploaded in ${totalDuration}s`);

  } catch (err) {
    const totalDuration = Math.round((Date.now() - startTime) / 1000);
    context.error(`[${jobId}] Failed after ${totalDuration}s:`, err);

    // Azure Functions will retry the message based on queue visibility timeout.
    // Throwing ensures the message returns to the queue for retry.
    throw err;
  }
}

app.storageQueue('processTransmogrifyJob', {
  queueName: QUEUE_NAME,
  connection: 'AzureWebJobsStorage',
  handler: processJob,
});
