/**
 * Focus Remix - Content Script Entry Point
 * Injected into all web pages to enable AI-powered DOM remixing
 */

import { RemixMessage } from '../shared/types';
import { AIRemixer } from './ai-remixer';
import { extractDOM } from './dom-extractor';

// Initialize AI remixer
const remixer = new AIRemixer();

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener(
  (message: RemixMessage, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse);
    return true; // Keep channel open for async response
  }
);

async function handleMessage(message: RemixMessage): Promise<{ success: boolean; error?: string; domContent?: string; aiExplanation?: string }> {
  switch (message.type) {
    case 'APPLY_REMIX':
      // AI response should be in the payload
      if (message.payload?.aiResponse) {
        try {
          // Pass generated images if available
          remixer.apply(message.payload.aiResponse, message.payload.generatedImages);
          return { 
            success: true,
            aiExplanation: message.payload.aiResponse.explanation,
          };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }
      return { success: false, error: 'No AI response provided' };

    case 'REMOVE_REMIX':
      remixer.remove();
      return { success: true };

    case 'GET_STATUS':
      return { success: true };

    case 'AI_ANALYZE':
      // Extract DOM and return it for AI analysis
      try {
        const domContent = extractDOM(true) as string;
        return { 
          success: true, 
          domContent,
        };
      } catch (error) {
        return { success: false, error: `DOM extraction failed: ${error}` };
      }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// Log that content script is loaded
console.log('[Focus Remix] Content script loaded');
