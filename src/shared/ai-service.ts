/**
 * AI Service v2
 * Handles communication with Azure OpenAI for full HTML generation
 */

import { aiConfig, isAIConfigured } from './config';
import { AIResponse, Recipe, buildPrompt, ImagePlaceholder } from './recipes';

export interface AIRequestOptions {
  recipe: Recipe;
  domContent: string; // Now actually semantic content
  customPrompt?: string;
  maxTokens?: number;
  includeImages?: boolean;
  timeoutMs?: number; // Timeout in milliseconds
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
 * Call Azure OpenAI to generate a complete HTML document
 */
export async function analyzeWithAI(options: AIRequestOptions): Promise<AIServiceResponse> {
  if (!isAIConfigured()) {
    return {
      success: false,
      error: 'Azure OpenAI is not configured. Please add your API key in the extension settings.',
    };
  }

  const { 
    recipe, 
    domContent, 
    customPrompt, 
    maxTokens = 16384, 
    includeImages = false,
    timeoutMs = 120000, // 2 minute default timeout
    abortSignal,
  } = options;
  
  const startTime = Date.now();
  
  console.log('[Focus Remix] AI Service - Starting request');
  console.log('[Focus Remix] Recipe:', recipe.id, 'Include images:', includeImages);
  console.log('[Focus Remix] Content length:', domContent.length, 'chars');
  console.log('[Focus Remix] Timeout:', timeoutMs / 1000, 'seconds');
  
  const { system, user } = buildPrompt(recipe, domContent, customPrompt, includeImages);
  
  console.log('[Focus Remix] System prompt length:', system.length, 'chars');
  console.log('[Focus Remix] User prompt length:', user.length, 'chars');
  console.log('[Focus Remix] Total prompt size:', (system.length + user.length), 'chars');

  const url = `${aiConfig.endpoint}/openai/deployments/${aiConfig.deployment}/chat/completions?api-version=${aiConfig.apiVersion}`;

  // Create an AbortController for timeout, or use provided signal
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.error('[Focus Remix] Request timed out after', timeoutMs / 1000, 'seconds');
    controller.abort();
  }, timeoutMs);
  
  // If an external abort signal is provided, listen to it
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      console.log('[Focus Remix] Request cancelled by user');
      controller.abort();
      clearTimeout(timeoutId);
    });
  }

  try {
    console.log('[Focus Remix] Sending request to Azure OpenAI...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': aiConfig.apiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_completion_tokens: maxTokens,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;
    console.log('[Focus Remix] Response received in', (elapsed / 1000).toFixed(1), 'seconds');

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Focus Remix] Azure OpenAI error:', response.status, errorText);
      return {
        success: false,
        error: `API error: ${response.status} - ${errorText}`,
        durationMs: elapsed,
      };
    }

    const result = await response.json();
    
    console.log('[Focus Remix] Finish reason:', result.choices?.[0]?.finish_reason);
    console.log('[Focus Remix] Token usage - Prompt:', result.usage?.prompt_tokens, 'Completion:', result.usage?.completion_tokens);
    
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      const refusal = result.choices?.[0]?.message?.refusal;
      if (refusal) {
        console.error('[Focus Remix] AI refused:', refusal);
        return { success: false, error: `AI refused: ${refusal}` };
      }
      
      console.error('[Focus Remix] No content in response:', result);
      return {
        success: false,
        error: `No response from AI. Finish reason: ${result.choices?.[0]?.finish_reason || 'unknown'}`,
      };
    }

    // Parse the JSON response
    console.log('[Focus Remix] Raw AI content (first 500 chars):', content.substring(0, 500));
    const aiResponse = parseAIResponse(content);
    
    if (!aiResponse.html) {
      console.error('[Focus Remix] No HTML in response');
      return {
        success: false,
        error: 'AI did not generate HTML content',
      };
    }
    
    console.log('[Focus Remix] Generated HTML length:', aiResponse.html.length);
    console.log('[Focus Remix] Image placeholders:', aiResponse.images?.length || 0);
    
    const totalElapsed = Date.now() - startTime;
    console.log('[Focus Remix] Total AI processing time:', (totalElapsed / 1000).toFixed(1), 'seconds');
    
    return {
      success: true,
      data: aiResponse,
      usage: {
        promptTokens: result.usage?.prompt_tokens || 0,
        completionTokens: result.usage?.completion_tokens || 0,
      },
      durationMs: totalElapsed,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;
    
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[Focus Remix] Request aborted (timeout) after', (elapsed / 1000).toFixed(1), 'seconds');
      return {
        success: false,
        error: `Request timed out after ${Math.round(elapsed / 1000)} seconds. The page may be too large or the API is slow.`,
        durationMs: elapsed,
      };
    }
    
    console.error('[Focus Remix] AI service error after', (elapsed / 1000).toFixed(1), 'seconds:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      durationMs: elapsed,
    };
  }
}

/**
 * Parse and validate the AI response (new format with full HTML)
 */
function parseAIResponse(content: string): AIResponse {
  try {
    const parsed = JSON.parse(content);
    
    const response: AIResponse = {
      html: '',
    };
    
    // Extract HTML - it should be a string
    if (typeof parsed.html === 'string') {
      // Fix any literal \n sequences that should be actual newlines
      response.html = parsed.html
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"');
    } else {
      console.error('[Focus Remix] HTML field is not a string:', typeof parsed.html);
    }
    
    // Extract explanation
    if (typeof parsed.explanation === 'string') {
      response.explanation = parsed.explanation;
    }
    
    // Extract image placeholders
    if (Array.isArray(parsed.images)) {
      response.images = parsed.images
        .filter((img: unknown): img is Record<string, unknown> =>
          typeof img === 'object' && img !== null &&
          typeof (img as Record<string, unknown>).id === 'string' &&
          typeof (img as Record<string, unknown>).prompt === 'string'
        )
        .map((img: Record<string, unknown>): ImagePlaceholder => ({
          id: img.id as string,
          prompt: img.prompt as string,
          size: (img.size as ImagePlaceholder['size']) || '1024x1024',
          style: (img.style as ImagePlaceholder['style']) || 'natural',
          altText: (img.altText as string) || 'AI generated image',
          placement: (img.placement as ImagePlaceholder['placement']) || 'inline',
        }));
      console.log('[Focus Remix] Parsed images from AI response:', response.images?.length || 0);
    }
    
    return response;
  } catch (error) {
    console.error('[Focus Remix] Failed to parse AI response:', error);
    console.error('[Focus Remix] Raw content:', content.substring(0, 1000));
    return { html: '' };
  }
}
