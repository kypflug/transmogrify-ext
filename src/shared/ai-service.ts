/**
 * AI Service
 * Handles communication with Azure OpenAI for DOM analysis
 */

import { aiConfig, isAIConfigured } from './config';
import { AIResponse, Recipe, buildPrompt } from './recipes';

export interface AIRequestOptions {
  recipe: Recipe;
  domContent: string;
  customPrompt?: string;
  maxTokens?: number;
  includeImages?: boolean;
}

export interface AIServiceResponse {
  success: boolean;
  data?: AIResponse;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Call Azure OpenAI to analyze the DOM and get remix instructions
 */
export async function analyzeWithAI(options: AIRequestOptions): Promise<AIServiceResponse> {
  if (!isAIConfigured()) {
    return {
      success: false,
      error: 'Azure OpenAI is not configured. Please add your API key in the extension settings.',
    };
  }

  const { recipe, domContent, customPrompt, maxTokens = 2000, includeImages = false } = options;
  const { system, user } = buildPrompt(recipe, domContent, customPrompt, includeImages);

  const url = `${aiConfig.endpoint}/openai/deployments/${aiConfig.deployment}/chat/completions?api-version=${aiConfig.apiVersion}`;

  try {
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
        max_tokens: maxTokens,
        temperature: 0.3, // Lower temperature for more consistent results
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Azure OpenAI error:', errorText);
      return {
        success: false,
        error: `API error: ${response.status} ${response.statusText}`,
      };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      return {
        success: false,
        error: 'No response from AI',
      };
    }

    // Parse the JSON response
    const aiResponse = parseAIResponse(content);
    
    return {
      success: true,
      data: aiResponse,
      usage: {
        promptTokens: result.usage?.prompt_tokens || 0,
        completionTokens: result.usage?.completion_tokens || 0,
      },
    };
  } catch (error) {
    console.error('AI service error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Parse and validate the AI response
 */
function parseAIResponse(content: string): AIResponse {
  try {
    const parsed = JSON.parse(content);
    
    // Validate and sanitize the response
    const response: AIResponse = {};
    
    if (Array.isArray(parsed.hide)) {
      response.hide = parsed.hide.filter((s: unknown) => typeof s === 'string');
    }
    
    if (typeof parsed.mainContent === 'string') {
      response.mainContent = parsed.mainContent;
    }
    
    if (typeof parsed.customCSS === 'string') {
      response.customCSS = sanitizeCSS(parsed.customCSS);
    }
    
    if (Array.isArray(parsed.modify)) {
      response.modify = parsed.modify
        .filter((m: unknown) => 
          typeof m === 'object' && m !== null &&
          typeof (m as Record<string, unknown>).selector === 'string' &&
          typeof (m as Record<string, unknown>).styles === 'object'
        )
        .map((m: { selector: string; styles: Record<string, string> }) => ({
          selector: m.selector,
          styles: sanitizeStyles(m.styles),
        }));
    }
    
    if (typeof parsed.explanation === 'string') {
      response.explanation = parsed.explanation;
    }
    
    return response;
  } catch (error) {
    console.error('Failed to parse AI response:', error, content);
    return {};
  }
}

/**
 * Sanitize CSS to prevent XSS
 */
function sanitizeCSS(css: string): string {
  // Remove potentially dangerous patterns
  return css
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/url\s*\(\s*["']?\s*data:/gi, 'url(')
    .replace(/@import/gi, '');
}

/**
 * Sanitize style object
 */
function sanitizeStyles(styles: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const allowedProperties = new Set([
    'display', 'visibility', 'opacity', 'position', 'top', 'left', 'right', 'bottom',
    'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'background', 'background-color', 'color', 'font-size', 'font-family',
    'line-height', 'text-align', 'border', 'border-radius', 'box-shadow',
    'z-index', 'overflow', 'flex', 'grid', 'transform',
  ]);
  
  for (const [key, value] of Object.entries(styles)) {
    const normalizedKey = key.toLowerCase();
    if (allowedProperties.has(normalizedKey) && typeof value === 'string') {
      // Remove dangerous patterns from values
      const sanitizedValue = value
        .replace(/expression\s*\(/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/url\s*\(/gi, '');
      sanitized[normalizedKey] = sanitizedValue;
    }
  }
  
  return sanitized;
}
