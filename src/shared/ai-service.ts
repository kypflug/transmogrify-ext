/**
 * AI Service v3
 * Multi-provider support: Azure OpenAI, OpenAI, Anthropic (Claude), Google (Gemini)
 */

import { resolveAIConfig, getProviderDisplayName, AzureOpenAIConfig, OpenAIConfig, AnthropicConfig, GoogleConfig } from './config';
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
    let result: ProviderResult;

    switch (effectiveConfig.provider) {
      case 'azure-openai':
        result = await callAzureOpenAI(effectiveConfig as AzureOpenAIConfig, system, user, maxTokens, controller.signal);
        break;
      case 'openai':
        result = await callOpenAI(effectiveConfig as OpenAIConfig, system, user, maxTokens, controller.signal);
        break;
      case 'anthropic':
        result = await callAnthropic(effectiveConfig as AnthropicConfig, system, user, maxTokens, controller.signal);
        break;
      case 'google':
        result = await callGoogle(effectiveConfig as GoogleConfig, system, user, maxTokens, controller.signal);
        break;
    }
    
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

// ─── Provider result interface ───────────────────────────────────────────────

interface ProviderResult {
  content?: string;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

// ─── Azure OpenAI ────────────────────────────────────────────────────────────

async function callAzureOpenAI(
  config: AzureOpenAIConfig, system: string, user: string, maxTokens: number, signal: AbortSignal
): Promise<ProviderResult> {
  const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;
  
  console.log('[Transmogrifier] Sending request to Azure OpenAI...');
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
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
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Transmogrifier] Azure OpenAI error:', response.status, errorText);
    return { error: `API error: ${response.status} - ${errorText}` };
  }

  const result = await response.json();
  return parseOpenAIResponse(result);
}

// ─── OpenAI (direct) ─────────────────────────────────────────────────────────

async function callOpenAI(
  config: OpenAIConfig, system: string, user: string, maxTokens: number, signal: AbortSignal
): Promise<ProviderResult> {
  const url = 'https://api.openai.com/v1/chat/completions';

  console.log('[Transmogrifier] Sending request to OpenAI...');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTokens,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Transmogrifier] OpenAI error:', response.status, errorText);
    return { error: `API error: ${response.status} - ${errorText}` };
  }

  const result = await response.json();
  return parseOpenAIResponse(result);
}

/**
 * Shared response parser for OpenAI-compatible APIs (Azure OpenAI + OpenAI direct)
 */
function parseOpenAIResponse(result: Record<string, unknown>): ProviderResult {
  const choices = result.choices as Array<Record<string, unknown>> | undefined;
  const usage = result.usage as Record<string, number> | undefined;

  const finishReason = choices?.[0]?.finish_reason as string | undefined;
  const message = choices?.[0]?.message as Record<string, string> | undefined;
  const content = message?.content;

  if (finishReason === 'length') {
    console.error('[Transmogrifier] Response truncated — hit max_completion_tokens limit');
    return {
      error: 'AI response was too long and got cut off. Try a shorter page or a simpler recipe.',
      usage: {
        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
      },
    };
  }

  if (!content) {
    const refusal = message?.refusal;
    if (refusal) {
      console.error('[Transmogrifier] AI refused:', refusal);
      return { error: `AI refused: ${refusal}` };
    }
    return { error: `No response from AI. Finish reason: ${finishReason || 'unknown'}` };
  }

  console.log('[Transmogrifier] Finish reason:', finishReason);
  console.log('[Transmogrifier] Token usage - Prompt:', usage?.prompt_tokens, 'Completion:', usage?.completion_tokens);

  return {
    content,
    usage: {
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
    },
  };
}

// ─── Anthropic (Claude) ──────────────────────────────────────────────────────

async function callAnthropic(
  config: AnthropicConfig, system: string, user: string, maxTokens: number, signal: AbortSignal
): Promise<ProviderResult> {
  const url = 'https://api.anthropic.com/v1/messages';

  // Anthropic doesn't have a response_format param, so we reinforce JSON in the system prompt
  const systemWithJson = system + '\n\nIMPORTANT: You MUST respond with a single valid JSON object and nothing else. No markdown fences, no commentary outside the JSON.';

  console.log('[Transmogrifier] Sending request to Anthropic (Claude)...');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      system: systemWithJson,
      messages: [
        { role: 'user', content: user },
      ],
      temperature: 0.7,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Transmogrifier] Anthropic error:', response.status, errorText);
    return { error: `API error: ${response.status} - ${errorText}` };
  }

  const result = await response.json();

  const stopReason = result.stop_reason as string | undefined;
  const contentBlocks = result.content as Array<{ type: string; text?: string }> | undefined;
  const usage = result.usage as { input_tokens?: number; output_tokens?: number } | undefined;

  if (stopReason === 'max_tokens') {
    return {
      error: 'AI response was too long and got cut off. Try a shorter page or a simpler recipe.',
      usage: {
        promptTokens: usage?.input_tokens || 0,
        completionTokens: usage?.output_tokens || 0,
      },
    };
  }

  const textBlock = contentBlocks?.find(b => b.type === 'text');
  if (!textBlock?.text) {
    return { error: 'No text content in Anthropic response.' };
  }

  console.log('[Transmogrifier] Stop reason:', stopReason);
  console.log('[Transmogrifier] Token usage - Input:', usage?.input_tokens, 'Output:', usage?.output_tokens);

  // Claude sometimes wraps JSON in ```json fences — strip them
  let content = textBlock.text.trim();
  content = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

  return {
    content,
    usage: {
      promptTokens: usage?.input_tokens || 0,
      completionTokens: usage?.output_tokens || 0,
    },
  };
}

// ─── Google (Gemini) ─────────────────────────────────────────────────────────

async function callGoogle(
  config: GoogleConfig, system: string, user: string, maxTokens: number, signal: AbortSignal
): Promise<ProviderResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  console.log('[Transmogrifier] Sending request to Google Gemini...');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: user }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: maxTokens,
        temperature: 0.7,
      },
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Transmogrifier] Google Gemini error:', response.status, errorText);
    return { error: `API error: ${response.status} - ${errorText}` };
  }

  const result = await response.json();

  const candidates = result.candidates as Array<Record<string, unknown>> | undefined;
  const usageMeta = result.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;

  if (!candidates || candidates.length === 0) {
    const blockReason = result.promptFeedback?.blockReason as string | undefined;
    if (blockReason) {
      return { error: `Google blocked the request: ${blockReason}` };
    }
    return { error: 'No candidates in Google Gemini response.' };
  }

  const candidate = candidates[0];
  const finishReason = candidate.finishReason as string | undefined;
  const contentParts = (candidate.content as { parts?: Array<{ text?: string }> })?.parts;

  if (finishReason === 'MAX_TOKENS') {
    return {
      error: 'AI response was too long and got cut off. Try a shorter page or a simpler recipe.',
      usage: {
        promptTokens: usageMeta?.promptTokenCount || 0,
        completionTokens: usageMeta?.candidatesTokenCount || 0,
      },
    };
  }

  if (finishReason === 'SAFETY') {
    return { error: 'Google Gemini blocked the response for safety reasons.' };
  }

  const text = contentParts?.map(p => p.text || '').join('') || '';
  if (!text) {
    return { error: 'No text content in Google Gemini response.' };
  }

  console.log('[Transmogrifier] Finish reason:', finishReason);
  console.log('[Transmogrifier] Token usage - Prompt:', usageMeta?.promptTokenCount, 'Candidates:', usageMeta?.candidatesTokenCount);

  return {
    content: text,
    usage: {
      promptTokens: usageMeta?.promptTokenCount || 0,
      completionTokens: usageMeta?.candidatesTokenCount || 0,
    },
  };
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
