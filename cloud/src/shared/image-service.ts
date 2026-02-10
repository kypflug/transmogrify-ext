/**
 * Cloud Image Generation Service
 * 
 * Server-side equivalent of the extension's image-service.ts.
 * Generates images using the user-provided image provider config.
 * Supports Azure OpenAI (gpt-image-1), OpenAI direct, and Google Gemini.
 */

import { UserImageConfig, ImagePlaceholder } from './types.js';

export interface GeneratedImageData {
  id: string;
  dataUrl: string;
  altText: string;
}

/**
 * Generate images from AI-provided placeholders using the user's image config
 */
export async function generateImagesFromPlaceholders(
  config: UserImageConfig,
  placeholders: ImagePlaceholder[],
): Promise<GeneratedImageData[]> {
  if (!placeholders || placeholders.length === 0) return [];

  const results: GeneratedImageData[] = [];

  // Process images sequentially to avoid rate limits
  for (let i = 0; i < placeholders.length; i++) {
    const placeholder = placeholders[i];
    const result = await generateSingleImage(config, placeholder);

    if (result) {
      results.push(result);
    }

    // Small delay between requests to be nice to the API
    if (i < placeholders.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Replace {{image-id}} placeholders in HTML with actual data URLs
 */
export function replaceImagePlaceholders(html: string, images: GeneratedImageData[]): string {
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

/**
 * Check if image config is usable
 */
export function isImageConfigured(config?: UserImageConfig): boolean {
  if (!config || config.provider === 'none') return false;
  if (config.provider === 'azure-openai') return !!(config.endpoint && config.apiKey);
  return !!config.apiKey;
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function generateSingleImage(
  config: UserImageConfig,
  placeholder: ImagePlaceholder,
): Promise<GeneratedImageData | null> {
  try {
    let base64: string | undefined;

    switch (config.provider) {
      case 'azure-openai':
        base64 = await generateAzureImage(config, placeholder);
        break;
      case 'openai':
        base64 = await generateOpenAIImage(config, placeholder);
        break;
      case 'google':
        base64 = await generateGoogleImage(config, placeholder);
        break;
      default:
        return null;
    }

    if (!base64) return null;

    return {
      id: placeholder.id,
      dataUrl: `data:image/png;base64,${base64}`,
      altText: placeholder.altText,
    };
  } catch (error) {
    console.error(`[Cloud] Image generation failed for ${placeholder.id}:`, error);
    return null;
  }
}

// ─── Azure OpenAI ────────────────────────────────────────────────────────────

async function generateAzureImage(
  config: UserImageConfig,
  placeholder: ImagePlaceholder,
): Promise<string | undefined> {
  const url = `${config.endpoint}/openai/deployments/${config.deployment}/images/generations?api-version=${config.apiVersion}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey!,
    },
    body: JSON.stringify({
      prompt: placeholder.prompt,
      n: 1,
      size: placeholder.size || '1024x1024',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Cloud] Azure image error: ${errorText}`);
    return undefined;
  }

  const result = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const imageData = result.data?.[0];
  if (!imageData) return undefined;

  // If we got base64, use it directly. Otherwise fetch the URL.
  if (imageData.b64_json) return imageData.b64_json;
  if (imageData.url) return await fetchImageAsBase64(imageData.url);
  return undefined;
}

// ─── OpenAI Direct ───────────────────────────────────────────────────────────

async function generateOpenAIImage(
  config: UserImageConfig,
  placeholder: ImagePlaceholder,
): Promise<string | undefined> {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'gpt-image-1',
      prompt: placeholder.prompt,
      n: 1,
      size: placeholder.size || '1024x1024',
      response_format: 'b64_json',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Cloud] OpenAI image error: ${errorText}`);
    return undefined;
  }

  const result = await response.json() as { data?: Array<{ b64_json?: string }> };
  return result.data?.[0]?.b64_json;
}

// ─── Google Gemini ───────────────────────────────────────────────────────────

async function generateGoogleImage(
  config: UserImageConfig,
  placeholder: ImagePlaceholder,
): Promise<string | undefined> {
  const model = config.model || 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: placeholder.prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: geminiAspectRatio(placeholder.size),
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Cloud] Gemini image error: ${errorText}`);
    return undefined;
  }

  const result = await response.json() as {
    candidates?: Array<{
      content: {
        parts: Array<{ inline_data?: { mime_type: string; data: string }; thought?: boolean }>;
      };
    }>;
  };

  const parts = result.candidates?.[0]?.content?.parts;
  if (!parts) return undefined;

  // Find the first inline_data part that is an image (skip thought images)
  const imagePart = parts.find(p => p.inline_data && !p.thought);
  return imagePart?.inline_data?.data;
}

/** Map size string to Gemini aspect ratio */
function geminiAspectRatio(size?: string): string {
  switch (size) {
    case '1024x1536': return '2:3';
    case '1536x1024': return '3:2';
    case '1024x1024': return '1:1';
    default: return '1:1';
  }
}

/** Fetch an image URL and return as base64 */
async function fetchImageAsBase64(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch {
    return undefined;
  }
}
