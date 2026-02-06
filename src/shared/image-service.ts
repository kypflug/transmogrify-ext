/**
 * Image Generation Service
 * Handles AI image generation via Azure OpenAI gpt-image-1
 */

import { imageConfig, isImageConfigured } from './config';

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
 * Generate images using Azure OpenAI gpt-image-1
 */
export async function generateImages(
  requests: ImageGenerationRequest[]
): Promise<ImageGenerationResponse> {
  if (!isImageConfigured()) {
    return {
      success: false,
      images: [],
      error: 'Image generation is not configured. Add VITE_AZURE_IMAGE_* to .env',
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
 * Generate a single image
 */
async function generateSingleImage(
  request: ImageGenerationRequest,
  id: string
): Promise<GeneratedImage> {
  const url = `${imageConfig.endpoint}/openai/deployments/${imageConfig.deployment}/images/generations?api-version=${imageConfig.apiVersion}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': imageConfig.apiKey,
      },
      body: JSON.stringify({
        prompt: request.prompt,
        n: 1,
        size: request.size || '1024x1024',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Transmogrifier] Image generation error:', errorText);
      return {
        id,
        error: `API error: ${response.status} ${response.statusText}`,
      };
    }

    const result = await response.json();
    const imageData = result.data?.[0];

    if (!imageData) {
      return {
        id,
        error: 'No image data returned',
      };
    }

    return {
      id,
      base64: imageData.b64_json,
      url: imageData.url,
      revisedPrompt: imageData.revised_prompt,
    };
  } catch (error) {
    console.error('[Transmogrifier] Image generation failed:', error);
    return {
      id,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Convert base64 image to data URL for use in img src
 */
export function base64ToDataUrl(base64: string, mimeType = 'image/png'): string {
  return `data:${mimeType};base64,${base64}`;
}
