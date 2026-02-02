/**
 * Focus Remix - Content Script Entry Point
 * Injected into all web pages to enable AI-powered page remixing
 */

import { RemixMessage } from '../shared/types';
import { extractContent, serializeContent } from './content-extractor';

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener(
  (message: RemixMessage, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse);
    return true; // Keep channel open for async response
  }
);

async function handleMessage(message: RemixMessage): Promise<{ success: boolean; error?: string; content?: string }> {
  switch (message.type) {
    case 'EXTRACT_CONTENT':
      // Extract semantic content from the page
      try {
        console.log('[Focus Remix] Extracting content...');
        const extracted = extractContent();
        const serialized = serializeContent(extracted);
        console.log('[Focus Remix] Content extracted, length:', serialized.length);
        return { 
          success: true, 
          content: serialized,
        };
      } catch (error) {
        console.error('[Focus Remix] Extraction error:', error);
        return { success: false, error: `Content extraction failed: ${error}` };
      }

    case 'GET_STATUS':
      return { success: true };

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// Log that content script is loaded
console.log('[Focus Remix] Content script loaded');
