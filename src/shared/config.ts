/**
 * AI Configuration
 * 
 * Type re-exports from @kypflug/transmogrifier-core, plus extension-specific
 * runtime config resolution (from encrypted user settings).
 */

// Re-export all config types from core so existing consumers don't break
export type {
  AIProvider,
  ImageProvider,
} from '@kypflug/transmogrifier-core';

export type {
  AzureOpenAIConfig,
  OpenAIConfig,
  AnthropicConfig,
  GoogleConfig,
  AIConfig,
} from '@kypflug/transmogrifier-core';

export type {
  AzureImageConfig,
  OpenAIImageConfig,
  GoogleImageConfig,
  NoImageConfig,
  ImageConfig,
} from '@kypflug/transmogrifier-core';

export { getProviderDisplayName } from '@kypflug/transmogrifier-core';

import type { AIConfig, ImageConfig } from '@kypflug/transmogrifier-core';

// ─── Runtime config resolution (from encrypted user settings only) ────────────

import { getEffectiveAIConfig, getEffectiveImageConfig } from './settings-service';

/** Default (unconfigured) AI config */
const UNCONFIGURED_AI: AIConfig = {
  provider: 'azure-openai',
  endpoint: '',
  apiKey: '',
  deployment: '',
  apiVersion: '',
};

/** Default (unconfigured) image config */
const UNCONFIGURED_IMAGE: ImageConfig = { provider: 'none' };

/**
 * Resolve the effective AI config at runtime from user settings.
 * Returns an unconfigured placeholder if no settings exist.
 */
export async function resolveAIConfig(): Promise<AIConfig> {
  try {
    const userConfig = await getEffectiveAIConfig();
    if (userConfig) {
      switch (userConfig.provider) {
        case 'azure-openai':
          return {
            provider: 'azure-openai',
            endpoint: userConfig.endpoint || '',
            apiKey: userConfig.apiKey,
            deployment: userConfig.deployment || 'gpt-4o',
            apiVersion: userConfig.apiVersion || '2024-10-21',
          };
        case 'openai':
          return { provider: 'openai', apiKey: userConfig.apiKey, model: userConfig.model || 'gpt-4o' };
        case 'anthropic':
          return { provider: 'anthropic', apiKey: userConfig.apiKey, model: userConfig.model || 'claude-sonnet-4-20250514' };
        case 'google':
          return { provider: 'google', apiKey: userConfig.apiKey, model: userConfig.model || 'gemini-2.0-flash' };
      }
    }
  } catch {
    // No settings available
  }
  return UNCONFIGURED_AI;
}

/**
 * Resolve the effective image config at runtime from user settings.
 */
export async function resolveImageConfig(): Promise<ImageConfig> {
  try {
    const userConfig = await getEffectiveImageConfig();
    if (userConfig) {
      switch (userConfig.provider) {
        case 'azure-openai':
          return {
            provider: 'azure-openai',
            endpoint: userConfig.endpoint || '',
            apiKey: userConfig.apiKey!,
            deployment: userConfig.deployment || 'gpt-image-1',
            apiVersion: userConfig.apiVersion || '2024-10-21',
          };
        case 'openai':
          return { provider: 'openai', apiKey: userConfig.apiKey!, model: userConfig.model || 'gpt-image-1' };
        case 'google':
          return { provider: 'google', apiKey: userConfig.apiKey!, model: userConfig.model || 'gemini-2.5-flash-image' };
        default:
          break;
      }
    }
  } catch {
    // No settings available
  }
  return UNCONFIGURED_IMAGE;
}

/**
 * Check if AI is configured (from user settings)
 */
export async function isAIConfiguredAsync(): Promise<boolean> {
  const config = await resolveAIConfig();
  switch (config.provider) {
    case 'azure-openai':
      return !!(config.endpoint && config.apiKey);
    case 'openai':
    case 'anthropic':
    case 'google':
      return !!config.apiKey;
    default:
      return false;
  }
}

/**
 * Check if image generation is configured (from user settings)
 */
export async function isImageConfiguredAsync(): Promise<boolean> {
  const config = await resolveImageConfig();
  switch (config.provider) {
    case 'azure-openai':
      return !!(config.endpoint && config.apiKey);
    case 'openai':
    case 'google':
      return !!config.apiKey;
    case 'none':
      return false;
    default:
      return false;
  }
}
