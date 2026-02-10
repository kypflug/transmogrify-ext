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

/** Max images generated concurrently per batch */
const IMAGE_CONCURRENCY = 3;
/** Per-image timeout — prevents a single slow image from eating the entire budget */
const IMAGE_TIMEOUT_MS = 90_000; // 90 seconds

/**
 * Generate images from AI-provided placeholders using the user's image config.
 * Images are generated in parallel batches (up to IMAGE_CONCURRENCY at a time)
 * to stay well within the Azure Functions 10-minute timeout while respecting
 * provider rate limits.
 */
export async function generateImagesFromPlaceholders(
  config: UserImageConfig,
  placeholders: ImagePlaceholder[],
): Promise<GeneratedImageData[]> {
  if (!placeholders || placeholders.length === 0) return [];

  const results: GeneratedImageData[] = [];

  // Process images in parallel batches to balance speed vs rate limits
  for (let i = 0; i < placeholders.length; i += IMAGE_CONCURRENCY) {
    const batch = placeholders.slice(i, i + IMAGE_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(placeholder => generateSingleImageWithTimeout(config, placeholder)),
    );
    results.push(...batchResults.filter((r): r is GeneratedImageData => r !== null));

    // Small delay between batches to be respectful of rate limits
    if (i + IMAGE_CONCURRENCY < placeholders.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/** Run a promise with a timeout; rejects if the promise doesn't settle in time */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/** Wrapper that applies a per-image timeout and catches errors gracefully */
async function generateSingleImageWithTimeout(
  config: UserImageConfig,
  placeholder: ImagePlaceholder,
): Promise<GeneratedImageData | null> {
  try {
    return await withTimeout(
      generateSingleImage(config, placeholder),
      IMAGE_TIMEOUT_MS,
      `Image ${placeholder.id}`,
    );
  } catch (error) {
    console.error(`[Cloud] Image generation failed for ${placeholder.id}:`, error);
    return null;
  }
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
