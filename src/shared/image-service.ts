/**
 * Image Generation Service
 * Supports Azure OpenAI (gpt-image-1) and OpenAI direct (gpt-image-1 / DALL-E 3)
 */

import { imageConfig, isImageConfigured, AzureImageConfig, OpenAIImageConfig } from './config';

export interface ImageGenerationRequest {
  prompt: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  quality?: 'standard' | 'hd';
  style?: 'natural' | 'vivid';
}

export interface GeneratedImage {
  id: string;
  url?: string;
  base64?: string;
  revisedPrompt?: string;
  error?: string;
}

export interface ImageGenerationResponse {
  success: boolean;
  images: GeneratedImage[];
  error?: string;
}

/**
 * Generate images using the configured provider
 */
export async function generateImages(
  requests: ImageGenerationRequest[]
): Promise<ImageGenerationResponse> {
  if (!isImageConfigured()) {
    return {
      success: false,
      images: [],
      error: 'Image generation is not configured. Set VITE_IMAGE_PROVIDER and the matching API key in .env',
    };
  }

  const results: GeneratedImage[] = [];

  // Process images sequentially to avoid rate limits
  for (let i = 0; i < requests.length; i++) {
    const request = requests[i];
    const result = await generateSingleImage(request, `img-${i}`);
    results.push(result);

    // Small delay between requests to be nice to the API
    if (i < requests.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const hasErrors = results.some((r) => r.error);
  return {
    success: !hasErrors,
    images: results,
    error: hasErrors ? 'Some images failed to generate' : undefined,
  };
}

/**
 * Generate a single image via the active provider
 */
async function generateSingleImage(
  request: ImageGenerationRequest,
  id: string
): Promise<GeneratedImage> {
  switch (imageConfig.provider) {
    case 'azure-openai':
      return generateAzureImage(imageConfig, request, id);
    case 'openai':
      return generateOpenAIImage(imageConfig, request, id);
    case 'none':
      return { id, error: 'Image generation is disabled' };
  }
}

// ─── Azure OpenAI image generation ───────────────────────────────────────────

async function generateAzureImage(
  config: AzureImageConfig,
  request: ImageGenerationRequest,
  id: string
): Promise<GeneratedImage> {
  const url = `${config.endpoint}/openai/deployments/${config.deployment}/images/generations?api-version=${config.apiVersion}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': config.apiKey,
      },
      body: JSON.stringify({
        prompt: request.prompt,
        n: 1,
        size: request.size || '1024x1024',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Transmogrifier] Azure image generation error:', errorText);
      return { id, error: `API error: ${response.status} ${response.statusText}` };
    }

    const result = await response.json();
    const imageData = result.data?.[0];
    if (!imageData) return { id, error: 'No image data returned' };

    return {
      id,
      base64: imageData.b64_json,
      url: imageData.url,
      revisedPrompt: imageData.revised_prompt,
    };
  } catch (error) {
    console.error('[Transmogrifier] Azure image generation failed:', error);
    return { id, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ─── OpenAI direct image generation ──────────────────────────────────────────

async function generateOpenAIImage(
  config: OpenAIImageConfig,
  request: ImageGenerationRequest,
  id: string
): Promise<GeneratedImage> {
  const url = 'https://api.openai.com/v1/images/generations';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        prompt: request.prompt,
        n: 1,
        size: request.size || '1024x1024',
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Transmogrifier] OpenAI image generation error:', errorText);
      return { id, error: `API error: ${response.status} ${response.statusText}` };
    }

    const result = await response.json();
    const imageData = result.data?.[0];
    if (!imageData) return { id, error: 'No image data returned' };

    return {
      id,
      base64: imageData.b64_json,
      url: imageData.url,
      revisedPrompt: imageData.revised_prompt,
    };
  } catch (error) {
    console.error('[Transmogrifier] OpenAI image generation failed:', error);
    return { id, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Convert base64 image to data URL for use in img src
 */
export function base64ToDataUrl(base64: string, mimeType = 'image/png'): string {
  return `data:${mimeType};base64,${base64}`;
}
