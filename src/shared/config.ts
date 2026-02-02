/**
 * AI Configuration
 * Loaded at build time via Vite's define
 */

export interface AIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export interface ImageConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

// These values are injected at build time from .env
export const aiConfig: AIConfig = {
  endpoint: import.meta.env.VITE_AZURE_OPENAI_ENDPOINT || '',
  apiKey: import.meta.env.VITE_AZURE_OPENAI_API_KEY || '',
  deployment: import.meta.env.VITE_AZURE_OPENAI_DEPLOYMENT || 'gpt-52',
  apiVersion: import.meta.env.VITE_AZURE_OPENAI_API_VERSION || '2024-10-21',
};

export const imageConfig: ImageConfig = {
  endpoint: import.meta.env.VITE_AZURE_IMAGE_ENDPOINT || '',
  apiKey: import.meta.env.VITE_AZURE_IMAGE_API_KEY || '',
  deployment: import.meta.env.VITE_AZURE_IMAGE_DEPLOYMENT || 'gpt-image-1',
  apiVersion: import.meta.env.VITE_AZURE_IMAGE_API_VERSION || '2024-10-21',
};

export function isAIConfigured(): boolean {
  return !!(aiConfig.endpoint && aiConfig.apiKey);
}

export function isImageConfigured(): boolean {
  return !!(imageConfig.endpoint && imageConfig.apiKey);
}
