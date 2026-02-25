/**
 * AI Service v3
 * Multi-provider support: Azure OpenAI, OpenAI, Anthropic (Claude), Google (Gemini)
 *
 * Provider call functions and response parsing come from @kypflug/transmogrifier-core.
 * This module adds extension-specific orchestration: config resolution, logging,
 * abort signal handling, and the AIServiceResponse wrapper.
 */

import { resolveAIConfig, getProviderDisplayName, AzureOpenAIConfig } from './config';
import { buildPrompt, parseAIResponse, parseExtractionResponse, dispatchAICall } from '@kypflug/transmogrifier-core';
import type { AIResponse, Recipe } from '@kypflug/transmogrifier-core';
import type { AIConfig } from '@kypflug/transmogrifier-core';

/**
 * Count paragraph blocks in serialized content.
 * Paragraphs are plain text lines separated by blank lines, excluding
 * headings (#), images (!), lists (-/1.), quotes (>), code blocks (```).
 */
function countParagraphs(content: string): number {
  const lines = content.split('\n');
  let count = 0;
  let inCodeBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (!trimmed) continue; // blank line
    if (trimmed.startsWith('#')) continue; // heading
    if (trimmed.startsWith('!')) continue; // image
    if (trimmed.startsWith('>')) continue; // quote
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) continue; // list
    if (trimmed.startsWith('---')) continue; // divider
    if (trimmed.startsWith('|')) continue; // table
    if (trimmed.startsWith('[Video]') || trimmed.startsWith('[Embedded')) continue;
    if (trimmed.startsWith('*') && trimmed.endsWith('*') && trimmed.length < 100) continue; // metadata line
    count++;
  }
  return count;
}

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
  
  const { system, user } = buildPrompt(recipe, domContent, customPrompt, includeImages, {
    paragraphCount: countParagraphs(domContent),
  });
  
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

/**
 * Call the configured AI provider to extract and clean content for deterministic rendering.
 * Used by the 'fast' recipe: AI cleans content, then it's rendered via the static template.
 */
export async function extractWithAI(options: {
  recipe: Recipe;
  domContent: string;
  abortSignal?: AbortSignal;
}): Promise<AIServiceResponse> {
  const effectiveConfig = await resolveAIConfig();

  const configured = effectiveConfig.provider === 'azure-openai'
    ? !!((effectiveConfig as AzureOpenAIConfig).endpoint && effectiveConfig.apiKey)
    : !!effectiveConfig.apiKey;

  if (!configured) {
    return {
      success: false,
      error: 'AI is not configured. Add your API key in Settings (⚙️).',
    };
  }

  const { recipe, domContent, abortSignal } = options;
  const startTime = Date.now();

  console.log(`[Transmogrifier] AI Extract - Starting (${getProviderDisplayName(effectiveConfig.provider)})`);

  const { system, user } = buildPrompt(recipe, domContent, undefined, false);
  const maxTokens = 16384;

  const controller = new AbortController();
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => controller.abort());
  }

  try {
    const result = await dispatchAICall(effectiveConfig as AIConfig, system, user, maxTokens, controller.signal);
    const elapsed = Date.now() - startTime;
    console.log('[Transmogrifier] Extraction response in', (elapsed / 1000).toFixed(1), 's');

    if (result.error) {
      return { success: false, error: result.error, usage: result.usage, durationMs: elapsed };
    }

    if (!result.content) {
      return { success: false, error: 'No response from AI.', durationMs: elapsed };
    }

    // Parse as extraction response
    const extraction = parseExtractionResponse(result.content);

    return {
      success: true,
      data: { html: '', extraction } as any,
      usage: result.usage,
      durationMs: elapsed,
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: 'Cancelled by user', durationMs: elapsed };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      durationMs: elapsed,
    };
  }
}
