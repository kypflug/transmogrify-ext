/**
 * Focus Remix - Service Worker (Background Script)
 * Handles AI analysis, image generation, and message routing
 */

import { RemixMessage, RemixResponse, RemixMode, GeneratedImageData } from '../shared/types';
import { loadPreferences, savePreferences } from '../shared/utils';
import { analyzeWithAI } from '../shared/ai-service';
import { getRecipe, AIResponse } from '../shared/recipes';
import { generateImages, base64ToDataUrl, ImageGenerationRequest } from '../shared/image-service';
import { isImageConfigured } from '../shared/config';

// Track remix state per tab
const tabStates = new Map<number, RemixMode>();

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Focus Remix] Extension installed');
    loadPreferences();
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener(
  (message: RemixMessage, sender, sendResponse: (response: RemixResponse) => void) => {
    handleMessage(message, sender.tab?.id).then(sendResponse);
    return true; // Keep channel open for async response
  }
);

async function handleMessage(
  message: RemixMessage,
  tabId?: number
): Promise<RemixResponse> {
  switch (message.type) {
    case 'AI_ANALYZE': {
      // Get the recipe
      const recipeId = message.payload?.recipeId || 'focus';
      const recipe = getRecipe(recipeId);
      const generateImagesFlag = message.payload?.generateImages ?? false;
      
      if (!recipe) {
        return { success: false, error: `Unknown recipe: ${recipeId}` };
      }

      // Get DOM content from content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        return { success: false, error: 'No active tab' };
      }

      // Request DOM extraction from content script
      let domContent: string;
      try {
        const domResponse = await chrome.tabs.sendMessage(tab.id, { type: 'AI_ANALYZE' });
        if (!domResponse?.success || !domResponse.domContent) {
          return { success: false, error: domResponse?.error || 'Failed to extract DOM' };
        }
        domContent = domResponse.domContent;
      } catch (error) {
        return { success: false, error: `Content script error: ${error}` };
      }

      // Call AI service
      const aiResult = await analyzeWithAI({
        recipe,
        domContent,
        customPrompt: message.payload?.customPrompt,
        includeImages: generateImagesFlag,
      });

      if (!aiResult.success || !aiResult.data) {
        return { success: false, error: aiResult.error || 'AI analysis failed' };
      }

      // Generate images if requested and AI returned image placeholders
      let generatedImages: GeneratedImageData[] = [];
      if (generateImagesFlag && aiResult.data.images && aiResult.data.images.length > 0) {
        if (!isImageConfigured()) {
          console.warn('[Focus Remix] Image generation requested but not configured');
        } else {
          generatedImages = await generateImagesFromPlaceholders(aiResult.data);
        }
      }

      // Send the AI response to the content script to apply
      try {
        const applyResponse = await chrome.tabs.sendMessage(tab.id, {
          type: 'APPLY_REMIX',
          payload: { 
            aiResponse: aiResult.data,
            generatedImages,
          },
        });

        if (applyResponse?.success) {
          tabStates.set(tab.id, 'ai');
          return { 
            success: true, 
            currentMode: 'ai',
            aiExplanation: aiResult.data.explanation,
          };
        } else {
          return { success: false, error: applyResponse?.error || 'Failed to apply remix' };
        }
      } catch (error) {
        return { success: false, error: `Failed to apply: ${error}` };
      }
    }

    case 'APPLY_REMIX': {
      // Direct apply (used internally after AI analysis)
      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }
      
      if (!tabId) {
        return { success: false, error: 'No tab specified' };
      }

      try {
        const response = await chrome.tabs.sendMessage(tabId, message);
        if (response?.success) {
          tabStates.set(tabId, 'ai');
        }
        return response;
      } catch (error) {
        return { success: false, error: `Content script error: ${error}` };
      }
    }

    case 'REMOVE_REMIX': {
      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }

      if (!tabId) {
        return { success: false, error: 'No tab specified' };
      }

      try {
        await chrome.tabs.sendMessage(tabId, message);
        tabStates.set(tabId, 'off');
        return { success: true, currentMode: 'off' };
      } catch (error) {
        return { success: false, error: `Content script error: ${error}` };
      }
    }

    case 'GET_STATUS': {
      const mode = tabId ? tabStates.get(tabId) ?? 'off' : 'off';
      return { success: true, currentMode: mode };
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
 * Generate images from AI-provided placeholders
 */
async function generateImagesFromPlaceholders(aiResponse: AIResponse): Promise<GeneratedImageData[]> {
  if (!aiResponse.images || aiResponse.images.length === 0) {
    return [];
  }

  console.log(`[Focus Remix] Generating ${aiResponse.images.length} images...`);

  // Build image generation requests
  const requests: ImageGenerationRequest[] = aiResponse.images.map((placeholder) => ({
    prompt: placeholder.prompt,
    size: placeholder.size || '1024x1024',
    style: placeholder.style || 'natural',
  }));

  // Generate all images
  const result = await generateImages(requests);

  // Map results back to GeneratedImageData format
  const generatedImages: GeneratedImageData[] = [];
  
  for (let i = 0; i < aiResponse.images.length; i++) {
    const placeholder = aiResponse.images[i];
    const generated = result.images[i];

    if (generated && !generated.error && generated.base64) {
      generatedImages.push({
        id: placeholder.id,
        dataUrl: base64ToDataUrl(generated.base64),
        altText: placeholder.altText,
      });
      console.log(`[Focus Remix] Generated image: ${placeholder.id}`);
    } else {
      console.warn(`[Focus Remix] Failed to generate image ${placeholder.id}:`, generated?.error);
    }
  }

  return generatedImages;
}

// Clean up state when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});
