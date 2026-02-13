/**
 * AI Service v3
 * Multi-provider support: Azure OpenAI, OpenAI, Anthropic (Claude), Google (Gemini)
 *
 * Provider call functions and response parsing come from @kypflug/transmogrifier-core.
 * This module adds extension-specific orchestration: config resolution, logging,
 * abort signal handling, and the AIServiceResponse wrapper.
 */

import { resolveAIConfig, getProviderDisplayName, AzureOpenAIConfig } from './config';
import { buildPrompt, parseAIResponse, dispatchAICall } from '@kypflug/transmogrifier-core';
import type { AIResponse, Recipe } from '@kypflug/transmogrifier-core';
import type { AIConfig } from '@kypflug/transmogrifier-core';

export interface AIRequestOptions {
  recipe: Recipe;
  domContent: string; // Now actually semantic content
  customPrompt?: string;
  maxTokens?: number;
  includeImages?: boolean;
  abortSignal?: AbortSignal; // For cancellation support
}

export interface AIServiceResponse {
  success: boolean;
  data?: AIResponse;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  durationMs?: number; // How long the call took
}

/**
 * Call the configured AI provider to generate a complete HTML document
 */
export async function analyzeWithAI(options: AIRequestOptions): Promise<AIServiceResponse> {
  // Resolve effective config from user settings
  const effectiveConfig = await resolveAIConfig();
  
  // Check if configured using the resolved config
  const configured = effectiveConfig.provider === 'azure-openai'
    ? !!((effectiveConfig as AzureOpenAIConfig).endpoint && effectiveConfig.apiKey)
    : !!effectiveConfig.apiKey;

  if (!configured) {
    return {
      success: false,
      error: `AI is not configured. Add your API key in Settings (⚙️).`,
    };
  }

  const { 
    recipe, 
    domContent, 
    customPrompt, 
    maxTokens = 32768, 
    includeImages = false,
    abortSignal,
  } = options;
  
  const startTime = Date.now();
  
  console.log(`[Transmogrifier] AI Service - Starting request (${getProviderDisplayName(effectiveConfig.provider)})`);
  console.log('[Transmogrifier] Recipe:', recipe.id, 'Include images:', includeImages);
  console.log('[Transmogrifier] Content length:', domContent.length, 'chars');
  
  const { system, user } = buildPrompt(recipe, domContent, customPrompt, includeImages);
  
  console.log('[Transmogrifier] System prompt length:', system.length, 'chars');
  console.log('[Transmogrifier] User prompt length:', user.length, 'chars');
  console.log('[Transmogrifier] Total prompt size:', (system.length + user.length), 'chars');

  // Use the provided abort signal for user-initiated cancellation only
  const controller = new AbortController();
  
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      console.log('[Transmogrifier] Request cancelled by user');
      controller.abort();
    });
  }

  try {
    const result = await dispatchAICall(effectiveConfig as AIConfig, system, user, maxTokens, controller.signal);
    
    const elapsed = Date.now() - startTime;
    console.log('[Transmogrifier] Response received in', (elapsed / 1000).toFixed(1), 'seconds');

    if (result.error) {
      return {
        success: false,
        error: result.error,
        usage: result.usage,
        durationMs: elapsed,
      };
    }

    if (!result.content) {
      return {
        success: false,
        error: 'No response from AI.',
        durationMs: elapsed,
      };
    }

    // Parse the JSON response
    console.log('[Transmogrifier] Raw AI content (first 500 chars):', result.content.substring(0, 500));
    const aiResponse = parseAIResponse(result.content);
    
    if (!aiResponse.html) {
      console.error('[Transmogrifier] No HTML in response');
      return {
        success: false,
        error: 'AI did not generate HTML content',
      };
    }
    
    console.log('[Transmogrifier] Generated HTML length:', aiResponse.html.length);
    console.log('[Transmogrifier] Image placeholders:', aiResponse.images?.length || 0);
    
    const totalElapsed = Date.now() - startTime;
    console.log('[Transmogrifier] Total AI processing time:', (totalElapsed / 1000).toFixed(1), 'seconds');
    
    return {
      success: true,
      data: aiResponse,
      usage: result.usage,
      durationMs: totalElapsed,
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('[Transmogrifier] Request aborted after', (elapsed / 1000).toFixed(1), 'seconds');
      return {
        success: false,
        error: 'Cancelled by user',
        durationMs: elapsed,
      };
    }
    
    console.error('[Transmogrifier] AI service error after', (elapsed / 1000).toFixed(1), 'seconds:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      durationMs: elapsed,
    };
  }
}
