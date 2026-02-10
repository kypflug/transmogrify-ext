/**
 * AI Configuration
 * 
 * Type definitions for AI and image provider configs.
 * All actual keys/settings come from the Settings UI (encrypted storage) 
 * at runtime — nothing is baked into the build.
 */

export type AIProvider = 'azure-openai' | 'openai' | 'anthropic' | 'google';
export type ImageProvider = 'azure-openai' | 'openai' | 'google' | 'none';

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

export interface GoogleImageConfig {
  provider: 'google';
  apiKey: string;
  model: string;
}

export interface NoImageConfig {
  provider: 'none';
}

export type ImageConfig = AzureImageConfig | OpenAIImageConfig | GoogleImageConfig | NoImageConfig;

// ─── Runtime config resolution (from encrypted user settings only) ────────────

import { getEffectiveAIConfig, getEffectiveImageConfig, getEffectiveCloudUrl } from './settings-service';

/** Human-readable name for any provider string */
export function getProviderDisplayName(provider: AIProvider | ImageProvider): string {
  switch (provider) {
    case 'azure-openai': return 'Azure OpenAI';
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic Claude';
    case 'google': return 'Google Gemini';
    case 'none': return 'None';
  }
}

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
 * Resolve the effective cloud API URL from user settings.
 */
export async function resolveCloudUrl(): Promise<string> {
  try {
    const userUrl = await getEffectiveCloudUrl();
    if (userUrl) return userUrl;
  } catch {
    // No settings available
  }
  return '';
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
  }
}

/**
 * Check if cloud queue is configured (from user settings)
 */
export async function isCloudConfiguredAsync(): Promise<boolean> {
  const url = await resolveCloudUrl();
  return !!url;
}
