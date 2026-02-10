/**
 * Cloud Queue Service for Transmogrifier
 * 
 * Sends URLs to the cloud API for asynchronous transmogrification.
 * The cloud function processes the page, generates HTML via AI, and
 * uploads the result directly to the user's OneDrive. The extension
 * picks it up on the next sync pull.
 * 
 * Requirements:
 * - User must be signed in (needs a valid Microsoft Graph access token)
 * - Cloud API URL must be configured in Settings
 * - AI keys must be configured in Settings (server has no keys of its own)
 */

import { getAccessToken } from './auth-service';
import { resolveCloudUrl } from './config';
import { getCloudAIConfig, getEffectiveImageConfig } from './settings-service';

export interface CloudQueueResponse {
  jobId: string;
  message: string;
  recipe?: string;
  recipeName?: string;
}

/**
 * Check if cloud queue is available (from user settings)
 */
export async function isCloudQueueConfiguredAsync(): Promise<boolean> {
  const url = await resolveCloudUrl();
  return !!url;
}

/**
 * Queue a URL for cloud transmogrification
 * 
 * @param url - The URL to transmogrify
 * @param recipeId - Recipe to apply (default: 'focus')
 * @param customPrompt - Optional custom prompt for the 'custom' recipe
 * @returns Job info with jobId
 * @throws If not signed in, not configured, or API error
 */
export async function queueForCloud(
  url: string,
  recipeId: string = 'focus',
  customPrompt?: string,
): Promise<CloudQueueResponse> {
  const cloudApiUrl = await resolveCloudUrl();

  if (!cloudApiUrl) {
    throw new Error('Cloud API is not configured. Set the Cloud API URL in Settings (⚙️).');
  }

  // Get the user's access token for OneDrive
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('You must be signed in to use cloud transmogrification');
  }

  // Get the user's AI config — required for cloud processing (server has no keys)
  const userAIConfig = await getCloudAIConfig();
  if (!userAIConfig) {
    throw new Error('AI keys are not configured. Set up your AI provider in Settings (⚙️) to use cloud processing.');
  }

  // Get the user's image config — optional, for image-enabled recipes
  const userImageConfig = await getEffectiveImageConfig();

  // Build request body with user's AI keys
  const body: Record<string, unknown> = {
    url,
    recipeId,
    accessToken,
    customPrompt,
    aiConfig: userAIConfig,
    imageConfig: userImageConfig || { provider: 'none' },
  };

  const response = await fetch(`${cloudApiUrl}/api/queue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((errorBody as { error?: string }).error || `Cloud API error: ${response.status}`);
  }

  return response.json();
}
