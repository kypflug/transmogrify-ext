/**
 * Focus Remix - Service Worker (Background Script)
 * Handles AI analysis, image generation, and saves remixed pages to IndexedDB
 * Supports parallel remix operations with independent progress tracking
 */

import { RemixMessage, RemixResponse, GeneratedImageData, RemixRequest } from '../shared/types';
import { loadPreferences, savePreferences } from '../shared/utils';
import { analyzeWithAI } from '../shared/ai-service';
import { getRecipe, ImagePlaceholder, BUILT_IN_RECIPES } from '../shared/recipes';
import { generateImages, base64ToDataUrl, ImageGenerationRequest } from '../shared/image-service';
import { isImageConfigured } from '../shared/config';
import { 
  saveArticle, 
  getArticle, 
  getAllArticles, 
  deleteArticle, 
  toggleFavorite, 
  exportArticleToFile,
  getStorageStats
} from '../shared/storage-service';

// In-memory storage for AbortControllers (per request)
const abortControllers = new Map<string, AbortController>();

// In-memory storage for elapsed time intervals
const elapsedIntervals = new Map<string, ReturnType<typeof setInterval>>();

// Max time a remix can run before being considered stale (5 minutes)
const STALE_REMIX_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get all active remixes from storage
 */
async function getActiveRemixes(): Promise<Record<string, RemixRequest>> {
  const { activeRemixes } = await chrome.storage.local.get('activeRemixes');
  return activeRemixes || {};
}

/**
 * Update a specific remix request in storage
 */
async function updateRemixProgress(requestId: string, updates: Partial<RemixRequest>) {
  const remixes = await getActiveRemixes();
  
  if (remixes[requestId]) {
    remixes[requestId] = { ...remixes[requestId], ...updates };
  } else {
    // New request - updates should contain all required fields
    remixes[requestId] = updates as RemixRequest;
  }
  
  await chrome.storage.local.set({ activeRemixes: remixes });
  
  // Update badge
  await updateBadge(remixes);
  
  // Send message to popup (if open)
  chrome.runtime.sendMessage({ 
    type: 'PROGRESS_UPDATE', 
    requestId,
    progress: remixes[requestId]
  }).catch(() => {
    // Popup might be closed, that's okay
  });
}

/**
 * Remove a remix request from storage (cleanup)
 */
async function removeRemixRequest(requestId: string) {
  const remixes = await getActiveRemixes();
  delete remixes[requestId];
  await chrome.storage.local.set({ activeRemixes: remixes });
  await updateBadge(remixes);
  
  // Cleanup interval and controller
  const interval = elapsedIntervals.get(requestId);
  if (interval) {
    clearInterval(interval);
    elapsedIntervals.delete(requestId);
  }
  abortControllers.delete(requestId);
}

/**
 * Update badge based on active remixes
 */
async function updateBadge(remixes: Record<string, RemixRequest>) {
  const activeList = Object.values(remixes);
  const inProgress = activeList.filter(r => 
    !['complete', 'error', 'idle'].includes(r.status)
  );
  const hasError = activeList.some(r => r.status === 'error');
  
  if (inProgress.length === 0) {
    // Check if any recently completed
    const recentComplete = activeList.some(r => r.status === 'complete');
    if (recentComplete) {
      await chrome.action.setBadgeText({ text: '✓' });
      await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    } else if (hasError) {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } else if (inProgress.length === 1) {
    // Single active - show status emoji
    const statusEmoji: Record<string, string> = {
      'extracting': '📄',
      'analyzing': '🤖',
      'generating-images': '🎨',
      'saving': '💾',
    };
    await chrome.action.setBadgeText({ text: statusEmoji[inProgress[0].status] || '⏳' });
    await chrome.action.setBadgeBackgroundColor({ color: '#9C27B0' });
  } else {
    // Multiple active - show count
    await chrome.action.setBadgeText({ text: String(inProgress.length) });
    await chrome.action.setBadgeBackgroundColor({ color: '#9C27B0' });
  }
}

/**
 * Cleanup stale remixes that got orphaned when service worker was suspended
 * This is called on startup and can be triggered manually
 */
async function cleanupStaleRemixes(): Promise<{ cleaned: number; remaining: number }> {
  const now = Date.now();
  const remixes = await getActiveRemixes();
  const cleaned: string[] = [];
  const remaining: Record<string, RemixRequest> = {};
  
  for (const [id, remix] of Object.entries(remixes)) {
    // Already completed or errored - schedule cleanup
    if (['complete', 'error'].includes(remix.status)) {
      scheduleCleanup(id, 1000);
      remaining[id] = remix;
      continue;
    }
    
    // Check if stale (running too long without our in-memory controller)
    const elapsed = now - remix.startTime;
    const hasController = abortControllers.has(id);
    
    if (elapsed > STALE_REMIX_THRESHOLD_MS && !hasController) {
      // This remix is orphaned - mark as error
      console.log(`[Focus Remix] Cleaning stale remix ${id} (${Math.round(elapsed / 1000)}s old)`);
      remix.status = 'error';
      remix.error = `Request orphaned after ${Math.round(elapsed / 1000)}s (service worker was suspended)`;
      cleaned.push(id);
      remaining[id] = remix;
      scheduleCleanup(id, 5000);
    } else {
      remaining[id] = remix;
    }
  }
  
  if (cleaned.length > 0) {
    await chrome.storage.local.set({ activeRemixes: remaining });
    await updateBadge(remaining);
    console.log(`[Focus Remix] Cleaned ${cleaned.length} stale remixes`);
  }
  
  return { cleaned: cleaned.length, remaining: Object.keys(remaining).length };
}

// Run cleanup on service worker startup (every time it wakes up)
cleanupStaleRemixes().catch(console.error);

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Focus Remix] Extension installed');
    loadPreferences();
  }
  // Clear any stale remixes on install/update
  chrome.storage.local.set({ activeRemixes: {} });
  chrome.action.setBadgeText({ text: '' });
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener(
  (message: RemixMessage, _sender, sendResponse: (response: RemixResponse) => void) => {
    handleMessage(message).then(sendResponse);
    return true; // Keep channel open for async response
  }
);

async function handleMessage(message: RemixMessage): Promise<RemixResponse> {
  switch (message.type) {
    case 'AI_ANALYZE': {
      return await performRemix(message);
    }

    case 'GET_ACTIVE_REMIXES': {
      const remixes = await getActiveRemixes();
      return { success: true, activeRemixes: Object.values(remixes) };
    }

    case 'CANCEL_REMIX': {
      const requestId = message.payload?.requestId;
      if (!requestId) {
        return { success: false, error: 'No request ID provided' };
      }
      
      // Abort the request
      const controller = abortControllers.get(requestId);
      if (controller) {
        controller.abort();
        console.log('[Focus Remix] Cancelled request:', requestId);
      }
      
      // Update status and cleanup
      await updateRemixProgress(requestId, { status: 'error', error: 'Cancelled by user' });
      setTimeout(() => removeRemixRequest(requestId), 3000);
      
      return { success: true };
    }

    case 'GET_PROGRESS': {
      // Legacy support - return first active remix or idle
      const remixes = await getActiveRemixes();
      const active = Object.values(remixes)[0];
      if (active) {
        return { 
          success: true, 
          progress: {
            status: active.status,
            step: active.step,
            error: active.error,
            startTime: active.startTime,
            pageTitle: active.pageTitle,
            recipeId: active.recipeId,
            articleId: active.articleId,
          }
        };
      }
      return { success: true, progress: { status: 'idle', step: '' } };
    }

    case 'RESET_PROGRESS': {
      // Clear all completed/errored remixes
      const remixes = await getActiveRemixes();
      const toKeep: Record<string, RemixRequest> = {};
      for (const [id, remix] of Object.entries(remixes)) {
        if (!['complete', 'error', 'idle'].includes(remix.status)) {
          toKeep[id] = remix;
        }
      }
      await chrome.storage.local.set({ activeRemixes: toKeep });
      await updateBadge(toKeep);
      return { success: true };
    }

    case 'CLEAR_STALE_REMIXES': {
      // Force cleanup all stale/stuck remixes
      const result = await cleanupStaleRemixes();
      // Also force-clear anything that's been running > 30 seconds without a controller
      const remixes = await getActiveRemixes();
      let forceCleaned = 0;
      for (const [id, remix] of Object.entries(remixes)) {
        if (!['complete', 'error', 'idle'].includes(remix.status) && !abortControllers.has(id)) {
          remix.status = 'error';
          remix.error = 'Manually cleared (no active controller)';
          remixes[id] = remix;
          forceCleaned++;
          scheduleCleanup(id, 1000);
        }
      }
      if (forceCleaned > 0) {
        await chrome.storage.local.set({ activeRemixes: remixes });
        await updateBadge(remixes);
      }
      return { success: true, cleaned: result.cleaned + forceCleaned };
    }

    case 'GET_ARTICLES': {
      try {
        const articles = await getAllArticles();
        return { success: true, articles };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'GET_ARTICLE': {
      try {
        const article = await getArticle(message.payload?.articleId || '');
        return { success: true, article: article || undefined };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'DELETE_ARTICLE': {
      try {
        await deleteArticle(message.payload?.articleId || '');
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'TOGGLE_FAVORITE': {
      try {
        const isFavorite = await toggleFavorite(message.payload?.articleId || '');
        return { success: true, isFavorite };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'EXPORT_ARTICLE': {
      try {
        await exportArticleToFile(message.payload?.articleId || '');
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'GET_STORAGE_STATS': {
      try {
        const stats = await getStorageStats();
        return { success: true, stats };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'OPEN_ARTICLE': {
      try {
        const articleId = message.payload?.articleId;
        if (!articleId) {
          return { success: false, error: 'No article ID provided' };
        }
        // Open the viewer page with the article ID
        const viewerUrl = chrome.runtime.getURL(`src/viewer/viewer.html?id=${articleId}`);
        await chrome.tabs.create({ url: viewerUrl, active: true });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'RESPIN_ARTICLE': {
      return await performRespin(message);
    }

    case 'GET_STATUS': {
      return { success: true };
    }

    case 'UPDATE_SETTINGS': {
      if (message.payload?.settings) {
        await savePreferences(message.payload.settings);
        return { success: true };
      }
      return { success: false, error: 'No settings provided' };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * Main remix operation - supports parallel execution
 */
async function performRemix(message: RemixMessage): Promise<RemixResponse> {
  const requestId = generateRequestId();
  console.log('[Focus Remix] AI_ANALYZE started, request:', requestId);
  
  // Get the recipe
  const recipeId = message.payload?.recipeId || 'focus';
  const recipe = getRecipe(recipeId);
  const generateImagesFlag = message.payload?.generateImages ?? false;
  
  console.log('[Focus Remix] Recipe:', recipeId, 'Generate images:', generateImagesFlag);
  
  if (!recipe) {
    return { success: false, error: `Unknown recipe: ${recipeId}` };
  }

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { success: false, error: 'No active tab' };
  }

  const pageTitle = tab.title || 'Remixed Page';
  const tabId = tab.id;
  
  // Initialize progress
  await updateRemixProgress(requestId, { 
    requestId,
    tabId,
    status: 'extracting', 
    step: 'Extracting page content...',
    startTime: Date.now(),
    pageTitle,
    recipeId,
  });

  // Request content extraction from content script
  let content: string;
  try {
    console.log('[Focus Remix] Requesting content extraction...');
    const extractResponse = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTENT' });
    if (!extractResponse?.success || !extractResponse.content) {
      const error = extractResponse?.error || 'Failed to extract content';
      await updateRemixProgress(requestId, { status: 'error', error });
      scheduleCleanup(requestId);
      return { success: false, error, requestId };
    }
    content = extractResponse.content;
    console.log('[Focus Remix] Content extracted, length:', content.length);
  } catch (error) {
    const errorMsg = `Content script error: ${error}`;
    await updateRemixProgress(requestId, { status: 'error', error: errorMsg });
    scheduleCleanup(requestId);
    return { success: false, error: errorMsg, requestId };
  }

  // Create AbortController for this request
  const controller = new AbortController();
  abortControllers.set(requestId, controller);

  // Call AI service to generate HTML with elapsed time updates
  const aiStartTime = Date.now();
  await updateRemixProgress(requestId, { status: 'analyzing', step: 'AI is generating HTML... (0s)' });
  
  // Update elapsed time every 5 seconds during AI call
  const elapsedInterval = setInterval(async () => {
    const elapsed = Math.round((Date.now() - aiStartTime) / 1000);
    await updateRemixProgress(requestId, { step: `AI is generating HTML... (${elapsed}s)` });
  }, 5000);
  elapsedIntervals.set(requestId, elapsedInterval);
  
  // Determine timeout and token limits based on recipe complexity
  const isImageHeavyRecipe = generateImagesFlag || recipeId === 'illustrated';
  const timeoutMs = isImageHeavyRecipe ? 300000 : 120000;
  const maxTokens = isImageHeavyRecipe ? 48000 : 16384;
  
  console.log('[Focus Remix] Calling Azure OpenAI (timeout:', timeoutMs / 1000, 's, max tokens:', maxTokens, ')...');
  const aiResult = await analyzeWithAI({
    recipe,
    domContent: content,
    customPrompt: message.payload?.customPrompt,
    includeImages: generateImagesFlag,
    timeoutMs,
    maxTokens,
    abortSignal: controller.signal,
  });
  
  clearInterval(elapsedInterval);
  elapsedIntervals.delete(requestId);
  
  const aiDuration = Math.round((Date.now() - aiStartTime) / 1000);
  console.log('[Focus Remix] AI response received in', aiDuration, 'seconds:', aiResult.success ? 'success' : 'failed', aiResult.error || '');

  if (!aiResult.success || !aiResult.data) {
    const error = aiResult.error || 'AI analysis failed';
    await updateRemixProgress(requestId, { status: 'error', error: `${error} (after ${aiDuration}s)` });
    scheduleCleanup(requestId);
    return { success: false, error, requestId };
  }

  let finalHtml = aiResult.data.html;

  // Generate images if requested and AI returned image placeholders
  if (generateImagesFlag && aiResult.data.images && aiResult.data.images.length > 0) {
    if (!isImageConfigured()) {
      console.warn('[Focus Remix] Image generation requested but not configured');
    } else {
      await updateRemixProgress(requestId, { 
        status: 'generating-images', 
        step: `Generating ${aiResult.data.images.length} images...` 
      });
      
      console.log('[Focus Remix] Generating', aiResult.data.images.length, 'images...');
      try {
        const generatedImages = await generateImagesFromPlaceholders(aiResult.data.images);
        console.log('[Focus Remix] Images generated:', generatedImages.length);
        
        // Replace image placeholders in HTML with actual data URLs
        finalHtml = replaceImagePlaceholders(finalHtml, generatedImages);
      } catch (imgError) {
        console.error('[Focus Remix] Image generation failed:', imgError);
        // Continue without images
      }
    }
  }

  // Save to IndexedDB and open viewer
  await updateRemixProgress(requestId, { status: 'saving', step: 'Saving remixed page...' });
  
  try {
    console.log('[Focus Remix] Saving to IndexedDB, HTML length:', finalHtml.length);
    
    // Get recipe name for display
    const recipeName = BUILT_IN_RECIPES.find(r => r.id === recipeId)?.name || recipeId;
    
    // Save to IndexedDB (include original content for respins)
    const savedArticle = await saveArticle({
      title: pageTitle,
      originalUrl: tab.url || '',
      recipeId,
      recipeName,
      html: finalHtml,
      originalContent: content,
    });
    
    console.log('[Focus Remix] Article saved:', savedArticle.id);
    
    // Open the viewer page
    const viewerUrl = chrome.runtime.getURL(`src/viewer/viewer.html?id=${savedArticle.id}`);
    await chrome.tabs.create({ url: viewerUrl, active: true });
    
    await updateRemixProgress(requestId, { 
      status: 'complete', 
      step: 'Done!',
      articleId: savedArticle.id,
    });
    
    // Cleanup after delay
    scheduleCleanup(requestId);
    
    return { 
      success: true, 
      aiExplanation: aiResult.data.explanation,
      articleId: savedArticle.id,
      requestId,
    };
  } catch (error) {
    const errorMsg = `Failed to save article: ${error}`;
    await updateRemixProgress(requestId, { status: 'error', error: errorMsg });
    scheduleCleanup(requestId);
    return { success: false, error: errorMsg, requestId };
  }
}

/**
 * Schedule cleanup of a remix request after a delay
 */
function scheduleCleanup(requestId: string, delayMs = 10000) {
  setTimeout(() => removeRemixRequest(requestId), delayMs);
}

/**
 * Respin an existing article with a new recipe
 */
async function performRespin(message: RemixMessage): Promise<RemixResponse> {
  const requestId = generateRequestId();
  const articleId = message.payload?.articleId;
  const recipeId = message.payload?.recipeId || 'focus';
  const generateImagesFlag = message.payload?.generateImages ?? false;
  
  if (!articleId) {
    return { success: false, error: 'No article ID provided' };
  }
  
  // Get the original article
  const originalArticle = await getArticle(articleId);
  if (!originalArticle) {
    return { success: false, error: 'Article not found' };
  }
  
  // Check if we have original content to respin
  if (!originalArticle.originalContent) {
    return { success: false, error: 'This article cannot be respun (no original content stored). Try remixing the original page again.' };
  }
  
  const recipe = getRecipe(recipeId);
  if (!recipe) {
    return { success: false, error: `Unknown recipe: ${recipeId}` };
  }
  
  console.log('[Focus Remix] Respinning article:', articleId, 'with recipe:', recipeId, 'request:', requestId);
  
  // Create AbortController for this request
  const controller = new AbortController();
  abortControllers.set(requestId, controller);
  
  // Update progress with elapsed time
  const aiStartTime = Date.now();
  await updateRemixProgress(requestId, { 
    requestId,
    tabId: 0, // No source tab for respin
    status: 'analyzing', 
    step: 'AI is generating new design... (0s)',
    startTime: aiStartTime,
    pageTitle: originalArticle.title,
    recipeId,
  });
  
  // Update elapsed time every 5 seconds
  const elapsedInterval = setInterval(async () => {
    const elapsed = Math.round((Date.now() - aiStartTime) / 1000);
    await updateRemixProgress(requestId, { step: `AI is generating new design... (${elapsed}s)` });
  }, 5000);
  elapsedIntervals.set(requestId, elapsedInterval);
  
  // Determine timeout and token limits based on recipe complexity
  const isImageHeavyRecipe = generateImagesFlag || recipeId === 'illustrated';
  const timeoutMs = isImageHeavyRecipe ? 300000 : 120000;
  const maxTokens = isImageHeavyRecipe ? 48000 : 16384;
  
  // Call AI service
  const aiResult = await analyzeWithAI({
    recipe,
    domContent: originalArticle.originalContent,
    customPrompt: message.payload?.customPrompt,
    includeImages: generateImagesFlag,
    timeoutMs,
    maxTokens,
    abortSignal: controller.signal,
  });
  
  clearInterval(elapsedInterval);
  elapsedIntervals.delete(requestId);
  
  const aiDuration = Math.round((Date.now() - aiStartTime) / 1000);
  
  if (!aiResult.success || !aiResult.data) {
    const error = aiResult.error || 'AI analysis failed';
    await updateRemixProgress(requestId, { status: 'error', error: `${error} (after ${aiDuration}s)` });
    scheduleCleanup(requestId);
    return { success: false, error, requestId };
  }
  
  let finalHtml = aiResult.data.html;
  
  // Generate images if requested
  if (generateImagesFlag && aiResult.data.images && aiResult.data.images.length > 0 && isImageConfigured()) {
    await updateRemixProgress(requestId, { 
      status: 'generating-images', 
      step: `Generating ${aiResult.data.images.length} images...` 
    });
    
    try {
      const generatedImages = await generateImagesFromPlaceholders(aiResult.data.images);
      finalHtml = replaceImagePlaceholders(finalHtml, generatedImages);
    } catch (imgError) {
      console.error('[Focus Remix] Image generation failed:', imgError);
    }
  }
  
  // Save as new article
  await updateRemixProgress(requestId, { status: 'saving', step: 'Saving new version...' });
  
  const recipeName = BUILT_IN_RECIPES.find(r => r.id === recipeId)?.name || recipeId;
  
  const newArticle = await saveArticle({
    title: originalArticle.title,
    originalUrl: originalArticle.originalUrl,
    recipeId,
    recipeName,
    html: finalHtml,
    originalContent: originalArticle.originalContent,
  });
  
  await updateRemixProgress(requestId, { 
    status: 'complete', 
    step: 'Done!',
    articleId: newArticle.id,
  });
  
  scheduleCleanup(requestId);
  
  return { 
    success: true, 
    aiExplanation: aiResult.data.explanation,
    articleId: newArticle.id,
    requestId,
  };
}

/**
 * Generate images from AI-provided placeholders
 */
async function generateImagesFromPlaceholders(placeholders: ImagePlaceholder[]): Promise<GeneratedImageData[]> {
  if (!placeholders || placeholders.length === 0) {
    return [];
  }

  console.log(`[Focus Remix] Generating ${placeholders.length} images...`);

  // Build image generation requests
  const requests: ImageGenerationRequest[] = placeholders.map((placeholder) => ({
    prompt: placeholder.prompt,
    size: placeholder.size || '1024x1024',
    style: placeholder.style || 'natural',
  }));

  // Generate all images
  const result = await generateImages(requests);

  // Map results back to GeneratedImageData format
  const generatedImages: GeneratedImageData[] = [];
  
  for (let i = 0; i < placeholders.length; i++) {
    const placeholder = placeholders[i];
    const generated = result.images[i];

    if (generated && !generated.error) {
      // Use base64 if available, otherwise use URL
      let dataUrl: string;
      if (generated.base64) {
        dataUrl = base64ToDataUrl(generated.base64);
      } else if (generated.url) {
        dataUrl = generated.url;
      } else {
        console.warn(`[Focus Remix] No image data for ${placeholder.id}`);
        continue;
      }
      
      generatedImages.push({
        id: placeholder.id,
        dataUrl,
        altText: placeholder.altText,
      });
      console.log(`[Focus Remix] Generated image: ${placeholder.id}`);
    } else {
      console.warn(`[Focus Remix] Failed to generate image ${placeholder.id}:`, generated?.error);
    }
  }

  return generatedImages;
}

/**
 * Replace {{image-id}} placeholders in HTML with actual data URLs
 */
function replaceImagePlaceholders(html: string, images: GeneratedImageData[]): string {
  let result = html;
  
  for (const image of images) {
    // Replace {{image-id}} patterns
    const placeholder = `{{${image.id}}}`;
    result = result.replaceAll(placeholder, image.dataUrl);
    
    // Also try without curly braces in case AI used different format
    result = result.replaceAll(image.id, image.dataUrl);
  }
  
  return result;
}
