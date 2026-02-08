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
    maxTokens = 32768, 
    includeImages = false,
    abortSignal,
  } = options;
  
  const startTime = Date.now();
  
  console.log('[Transmogrifier] AI Service - Starting request');
  console.log('[Transmogrifier] Recipe:', recipe.id, 'Include images:', includeImages);
  console.log('[Transmogrifier] Content length:', domContent.length, 'chars');
  
  const { system, user } = buildPrompt(recipe, domContent, customPrompt, includeImages);
  
  console.log('[Transmogrifier] System prompt length:', system.length, 'chars');
  console.log('[Transmogrifier] User prompt length:', user.length, 'chars');
  console.log('[Transmogrifier] Total prompt size:', (system.length + user.length), 'chars');

  const url = `${aiConfig.endpoint}/openai/deployments/${aiConfig.deployment}/chat/completions?api-version=${aiConfig.apiVersion}`;

  // Use the provided abort signal for user-initiated cancellation only
  const controller = new AbortController();
  
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      console.log('[Transmogrifier] Request cancelled by user');
      controller.abort();
    });
  }

  try {
    console.log('[Transmogrifier] Sending request to Azure OpenAI...');
    
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
    
    const elapsed = Date.now() - startTime;
    console.log('[Transmogrifier] Response received in', (elapsed / 1000).toFixed(1), 'seconds');

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Transmogrifier] Azure OpenAI error:', response.status, errorText);
      return {
        success: false,
        error: `API error: ${response.status} - ${errorText}`,
        durationMs: elapsed,
      };
    }

    const result = await response.json();
    
    console.log('[Transmogrifier] Finish reason:', result.choices?.[0]?.finish_reason);
    console.log('[Transmogrifier] Token usage - Prompt:', result.usage?.prompt_tokens, 'Completion:', result.usage?.completion_tokens);
    
    const finishReason = result.choices?.[0]?.finish_reason;
    const content = result.choices?.[0]?.message?.content;

    if (finishReason === 'length') {
      console.error('[Transmogrifier] Response truncated — hit max_completion_tokens limit');
      return {
        success: false,
        error: 'AI response was too long and got cut off. Try a shorter page or a simpler recipe.',
        usage: {
          promptTokens: result.usage?.prompt_tokens || 0,
          completionTokens: result.usage?.completion_tokens || 0,
        },
        durationMs: Date.now() - startTime,
      };
    }

    if (!content) {
      const refusal = result.choices?.[0]?.message?.refusal;
      if (refusal) {
        console.error('[Transmogrifier] AI refused:', refusal);
        return { success: false, error: `AI refused: ${refusal}` };
      }
      
      console.error('[Transmogrifier] No content in response:', result);
      return {
        success: false,
        error: `No response from AI. Finish reason: ${finishReason || 'unknown'}`,
      };
    }

    // Parse the JSON response
    console.log('[Transmogrifier] Raw AI content (first 500 chars):', content.substring(0, 500));
    const aiResponse = parseAIResponse(content);
    
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
      usage: {
        promptTokens: result.usage?.prompt_tokens || 0,
        completionTokens: result.usage?.completion_tokens || 0,
      },
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
      console.error('[Transmogrifier] HTML field is not a string:', typeof parsed.html);
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
      console.log('[Transmogrifier] Parsed images from AI response:', response.images?.length || 0);
    }
    
    return response;
  } catch (error) {
    console.error('[Transmogrifier] Failed to parse AI response:', error);
    console.error('[Transmogrifier] Raw content:', content.substring(0, 1000));
    return { html: '' };
  }
}
