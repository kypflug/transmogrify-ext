/**
 * AI Configuration
 * Supports multiple providers: Azure OpenAI, OpenAI, Anthropic (Claude), Google (Gemini)
 * Provider is selected via VITE_AI_PROVIDER env var at build time.
 */

export type AIProvider = 'azure-openai' | 'openai' | 'anthropic' | 'google';
export type ImageProvider = 'azure-openai' | 'openai' | 'none';

// --- Provider-specific configs ---

export interface AzureOpenAIConfig {
  provider: 'azure-openai';
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export interface OpenAIConfig {
  provider: 'openai';
  apiKey: string;
  model: string;
}

export interface AnthropicConfig {
  provider: 'anthropic';
  apiKey: string;
  model: string;
}

export interface GoogleConfig {
  provider: 'google';
  apiKey: string;
  model: string;
}

export type AIConfig = AzureOpenAIConfig | OpenAIConfig | AnthropicConfig | GoogleConfig;

export interface AzureImageConfig {
  provider: 'azure-openai';
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export interface OpenAIImageConfig {
  provider: 'openai';
  apiKey: string;
  model: string;
}

export interface NoImageConfig {
  provider: 'none';
}

export type ImageConfig = AzureImageConfig | OpenAIImageConfig | NoImageConfig;

// --- Build the active configs from env vars ---

const aiProvider = (import.meta.env.VITE_AI_PROVIDER || 'azure-openai') as AIProvider;
const imageProvider = (import.meta.env.VITE_IMAGE_PROVIDER || 'azure-openai') as ImageProvider;

function buildAIConfig(): AIConfig {
  switch (aiProvider) {
    case 'openai':
      return {
        provider: 'openai',
        apiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
        model: import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o',
      };
    case 'anthropic':
      return {
        provider: 'anthropic',
        apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY || '',
        model: import.meta.env.VITE_ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      };
    case 'google':
      return {
        provider: 'google',
        apiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
        model: import.meta.env.VITE_GOOGLE_MODEL || 'gemini-2.0-flash',
      };
    case 'azure-openai':
    default:
      return {
        provider: 'azure-openai',
        endpoint: import.meta.env.VITE_AZURE_OPENAI_ENDPOINT || '',
        apiKey: import.meta.env.VITE_AZURE_OPENAI_API_KEY || '',
        deployment: import.meta.env.VITE_AZURE_OPENAI_DEPLOYMENT || 'gpt-52',
        apiVersion: import.meta.env.VITE_AZURE_OPENAI_API_VERSION || '2024-10-21',
      };
  }
}

function buildImageConfig(): ImageConfig {
  switch (imageProvider) {
    case 'openai':
      return {
        provider: 'openai',
        apiKey: import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.VITE_OPENAI_IMAGE_API_KEY || '',
        model: import.meta.env.VITE_OPENAI_IMAGE_MODEL || 'gpt-image-1',
      };
    case 'azure-openai':
      return {
        provider: 'azure-openai',
        endpoint: import.meta.env.VITE_AZURE_IMAGE_ENDPOINT || '',
        apiKey: import.meta.env.VITE_AZURE_IMAGE_API_KEY || '',
        deployment: import.meta.env.VITE_AZURE_IMAGE_DEPLOYMENT || 'gpt-image-1',
        apiVersion: import.meta.env.VITE_AZURE_IMAGE_API_VERSION || '2024-10-21',
      };
    case 'none':
    default:
      // If no image provider is set, try Azure as fallback for backwards compat
      if (import.meta.env.VITE_AZURE_IMAGE_ENDPOINT && import.meta.env.VITE_AZURE_IMAGE_API_KEY) {
        return {
          provider: 'azure-openai',
          endpoint: import.meta.env.VITE_AZURE_IMAGE_ENDPOINT,
          apiKey: import.meta.env.VITE_AZURE_IMAGE_API_KEY,
          deployment: import.meta.env.VITE_AZURE_IMAGE_DEPLOYMENT || 'gpt-image-1',
          apiVersion: import.meta.env.VITE_AZURE_IMAGE_API_VERSION || '2024-10-21',
        };
      }
      return { provider: 'none' };
  }
}

export const aiConfig: AIConfig = buildAIConfig();
export const imageConfig: ImageConfig = buildImageConfig();

export function isAIConfigured(): boolean {
  switch (aiConfig.provider) {
    case 'azure-openai':
      return !!(aiConfig.endpoint && aiConfig.apiKey);
    case 'openai':
    case 'anthropic':
    case 'google':
      return !!aiConfig.apiKey;
  }
}

export function isImageConfigured(): boolean {
  switch (imageConfig.provider) {
    case 'azure-openai':
      return !!(imageConfig.endpoint && imageConfig.apiKey);
    case 'openai':
      return !!imageConfig.apiKey;
    case 'none':
      return false;
  }
}

/** Human-readable name for the active AI provider */
export function getProviderName(): string {
  switch (aiConfig.provider) {
    case 'azure-openai': return 'Azure OpenAI';
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic Claude';
    case 'google': return 'Google Gemini';
  }
}
