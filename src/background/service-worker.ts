/**
 * Focus Remix - Service Worker (Background Script)
 * Handles AI analysis, image generation, and saves remixed pages to IndexedDB
 */

import { RemixMessage, RemixResponse, GeneratedImageData } from '../shared/types';
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

// Progress state stored in chrome.storage for resilience
interface RemixProgress {
  status: 'idle' | 'extracting' | 'analyzing' | 'generating-images' | 'saving' | 'complete' | 'error';
  step: string;
  error?: string;
  startTime?: number;
  pageTitle?: string;
  recipeId?: string;
  explanation?: string;
  articleId?: string; // ID of saved article in IndexedDB
}

// Update progress in storage and badge
async function updateProgress(progress: Partial<RemixProgress>) {
  const current = await getProgress();
  const updated: RemixProgress = { ...current, ...progress };
  await chrome.storage.local.set({ remixProgress: updated });
  
  // Update badge to show status
  const badgeConfig: Record<string, { text: string; color: string }> = {
    'idle': { text: '', color: '#888' },
    'extracting': { text: '📄', color: '#2196F3' },
    'analyzing': { text: '🤖', color: '#9C27B0' },
    'generating-images': { text: '🎨', color: '#FF9800' },
    'saving': { text: '💾', color: '#4CAF50' },
    'complete': { text: '✓', color: '#4CAF50' },
    'error': { text: '!', color: '#F44336' },
  };
  
  const config = badgeConfig[updated.status] || badgeConfig.idle;
  await chrome.action.setBadgeText({ text: config.text });
  await chrome.action.setBadgeBackgroundColor({ color: config.color });
  
  // Send message to popup (if open)
  chrome.runtime.sendMessage({ 
    type: 'PROGRESS_UPDATE', 
    progress: updated 
  }).catch(() => {
    // Popup might be closed, that's okay
  });
}

async function getProgress(): Promise<RemixProgress> {
  const { remixProgress } = await chrome.storage.local.get('remixProgress');
  return remixProgress || { status: 'idle', step: '' };
}

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Focus Remix] Extension installed');
    loadPreferences();
  }
  // Clear any stale progress on install/update
  updateProgress({ status: 'idle', step: '' });
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

    case 'GET_PROGRESS': {
      const progress = await getProgress();
      return { success: true, progress };
    }

    case 'RESET_PROGRESS': {
      await updateProgress({ status: 'idle', step: '', error: undefined });
      return { success: true };
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
 * Main remix operation - extracted for clarity
 */
async function performRemix(message: RemixMessage): Promise<RemixResponse> {
  console.log('[Focus Remix] AI_ANALYZE started');
  
  // Get the recipe
  const recipeId = message.payload?.recipeId || 'focus';
  const recipe = getRecipe(recipeId);
  const generateImagesFlag = message.payload?.generateImages ?? false;
  
  console.log('[Focus Remix] Recipe:', recipeId, 'Generate images:', generateImagesFlag);
  
  if (!recipe) {
    await updateProgress({ status: 'error', error: `Unknown recipe: ${recipeId}` });
    return { success: false, error: `Unknown recipe: ${recipeId}` };
  }

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    await updateProgress({ status: 'error', error: 'No active tab' });
    return { success: false, error: 'No active tab' };
  }

  const pageTitle = tab.title || 'Remixed Page';
  
  // Initialize progress
  await updateProgress({ 
    status: 'extracting', 
    step: 'Extracting page content...',
    startTime: Date.now(),
    pageTitle,
    recipeId,
    error: undefined,
  });

  // Request content extraction from content script
  let content: string;
  try {
    console.log('[Focus Remix] Requesting content extraction...');
    const extractResponse = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' });
    if (!extractResponse?.success || !extractResponse.content) {
      const error = extractResponse?.error || 'Failed to extract content';
      await updateProgress({ status: 'error', error });
      return { success: false, error };
    }
    content = extractResponse.content;
    console.log('[Focus Remix] Content extracted, length:', content.length);
  } catch (error) {
    const errorMsg = `Content script error: ${error}`;
    await updateProgress({ status: 'error', error: errorMsg });
    return { success: false, error: errorMsg };
  }

  // Call AI service to generate HTML with elapsed time updates
  const aiStartTime = Date.now();
  await updateProgress({ status: 'analyzing', step: 'AI is generating HTML... (0s)' });
  
  // Update elapsed time every 5 seconds during AI call
  const elapsedInterval = setInterval(async () => {
    const elapsed = Math.round((Date.now() - aiStartTime) / 1000);
    await updateProgress({ step: `AI is generating HTML... (${elapsed}s)` });
  }, 5000);
  
  // Determine timeout and token limits based on recipe complexity
  // Illustrated recipe needs more time/tokens for image prompts
  const isImageHeavyRecipe = generateImagesFlag || recipeId === 'illustrated';
  const timeoutMs = isImageHeavyRecipe ? 300000 : 120000; // 5 min for images, 2 min otherwise
  const maxTokens = isImageHeavyRecipe ? 48000 : 16384; // More tokens for image descriptions
  
  console.log('[Focus Remix] Calling Azure OpenAI (timeout:', timeoutMs / 1000, 's, max tokens:', maxTokens, ')...');
  const aiResult = await analyzeWithAI({
    recipe,
    domContent: content,
    customPrompt: message.payload?.customPrompt,
    includeImages: generateImagesFlag,
    timeoutMs,
    maxTokens,
  });
  
  clearInterval(elapsedInterval);
  
  const aiDuration = Math.round((Date.now() - aiStartTime) / 1000);
  console.log('[Focus Remix] AI response received in', aiDuration, 'seconds:', aiResult.success ? 'success' : 'failed', aiResult.error || '');

  if (!aiResult.success || !aiResult.data) {
    const error = aiResult.error || 'AI analysis failed';
    await updateProgress({ status: 'error', error: `${error} (after ${aiDuration}s)` });
    return { success: false, error };
  }

  let finalHtml = aiResult.data.html;

  // Generate images if requested and AI returned image placeholders
  if (generateImagesFlag && aiResult.data.images && aiResult.data.images.length > 0) {
    if (!isImageConfigured()) {
      console.warn('[Focus Remix] Image generation requested but not configured');
    } else {
      await updateProgress({ 
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
  await updateProgress({ status: 'saving', step: 'Saving remixed page...' });
  
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
      originalContent: content, // Store for respin capability
    });
    
    console.log('[Focus Remix] Article saved:', savedArticle.id);
    
    // Open the viewer page
    const viewerUrl = chrome.runtime.getURL(`src/viewer/viewer.html?id=${savedArticle.id}`);
    await chrome.tabs.create({ url: viewerUrl, active: true });
    
    await updateProgress({ 
      status: 'complete', 
      step: 'Done!',
      explanation: aiResult.data.explanation,
      articleId: savedArticle.id,
    });
    
    // Clear badge after a delay
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 3000);
    
    return { 
      success: true, 
      aiExplanation: aiResult.data.explanation,
      articleId: savedArticle.id,
    };
  } catch (error) {
    const errorMsg = `Failed to save article: ${error}`;
    await updateProgress({ status: 'error', error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Respin an existing article with a new recipe
 */
async function performRespin(message: RemixMessage): Promise<RemixResponse> {
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
  
  console.log('[Focus Remix] Respinning article:', articleId, 'with recipe:', recipeId);
  
  // Update progress with elapsed time
  const aiStartTime = Date.now();
  await updateProgress({ 
    status: 'analyzing', 
    step: 'AI is generating new design... (0s)',
    startTime: aiStartTime,
    pageTitle: originalArticle.title,
    recipeId,
  });
  
  // Update elapsed time every 5 seconds
  const elapsedInterval = setInterval(async () => {
    const elapsed = Math.round((Date.now() - aiStartTime) / 1000);
    await updateProgress({ step: `AI is generating new design... (${elapsed}s)` });
  }, 5000);
  
  // Determine timeout and token limits based on recipe complexity
  const isImageHeavyRecipe = generateImagesFlag || recipeId === 'illustrated';
  const timeoutMs = isImageHeavyRecipe ? 300000 : 120000; // 5 min for images, 2 min otherwise
  const maxTokens = isImageHeavyRecipe ? 48000 : 16384;
  
  // Call AI service
  const aiResult = await analyzeWithAI({
    recipe,
    domContent: originalArticle.originalContent,
    customPrompt: message.payload?.customPrompt,
    includeImages: generateImagesFlag,
    timeoutMs,
    maxTokens,
  });
  
  clearInterval(elapsedInterval);
  
  const aiDuration = Math.round((Date.now() - aiStartTime) / 1000);
  
  if (!aiResult.success || !aiResult.data) {
    const error = aiResult.error || 'AI analysis failed';
    await updateProgress({ status: 'error', error: `${error} (after ${aiDuration}s)` });
    return { success: false, error };
  }
  
  let finalHtml = aiResult.data.html;
  
  // Generate images if requested
  if (generateImagesFlag && aiResult.data.images && aiResult.data.images.length > 0 && isImageConfigured()) {
    await updateProgress({ 
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
  await updateProgress({ status: 'saving', step: 'Saving new version...' });
  
  const recipeName = BUILT_IN_RECIPES.find(r => r.id === recipeId)?.name || recipeId;
  
  const newArticle = await saveArticle({
    title: originalArticle.title,
    originalUrl: originalArticle.originalUrl,
    recipeId,
    recipeName,
    html: finalHtml,
    originalContent: originalArticle.originalContent,
  });
  
  await updateProgress({ 
    status: 'complete', 
    step: 'Done!',
    explanation: aiResult.data.explanation,
    articleId: newArticle.id,
  });
  
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 3000);
  
  return { 
    success: true, 
    aiExplanation: aiResult.data.explanation,
    articleId: newArticle.id,
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
