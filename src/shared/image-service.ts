/**
 * Image Generation Service
 *
 * Extension-specific orchestration around @kypflug/transmogrifier-core
 * image provider calls. Adds config resolution, sequential processing,
 * and the ImageGenerationResponse wrapper.
 */

import { resolveImageConfig, AzureImageConfig, OpenAIImageConfig, GoogleImageConfig, ImageConfig } from './config';
import {
  dispatchImageCall,
  base64ToDataUrl,
} from '@kypflug/transmogrifier-core';
import type { ImageGenerationRequest, GeneratedImage } from '@kypflug/transmogrifier-core';

export type { ImageGenerationRequest, GeneratedImage };
export { base64ToDataUrl };

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
  // Resolve effective image config from user settings
  const effectiveConfig = await resolveImageConfig();

  const configured = effectiveConfig.provider === 'azure-openai'
    ? !!((effectiveConfig as AzureImageConfig).endpoint && effectiveConfig.apiKey)
    : effectiveConfig.provider !== 'none' && !!(effectiveConfig as OpenAIImageConfig | GoogleImageConfig).apiKey;

  if (!configured) {
    return {
      success: false,
      images: [],
      error: 'Image generation is not configured. Set up an image provider in Settings (⚙️).',
    };
  }

  const results: GeneratedImage[] = [];

  // Process images sequentially to avoid rate limits
  for (let i = 0; i < requests.length; i++) {
    const request = requests[i];
    const result = await generateSingleImageWithConfig(effectiveConfig, request, `img-${i}`);
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
 * Generate a single image via the active provider (using resolved config)
 */
async function generateSingleImageWithConfig(
  config: ImageConfig,
  request: ImageGenerationRequest,
  id: string
): Promise<GeneratedImage> {
  return dispatchImageCall(config, request, id);
}
