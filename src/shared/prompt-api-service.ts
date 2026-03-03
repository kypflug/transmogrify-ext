/**
 * Prompt API Service — On-Device AI via browser LanguageModel API
 *
 * Uses Edge's built-in Phi 4 Mini model (or Chrome's Gemini Nano) for local
 * content extraction/cleaning. Only supports the Fast recipe (ai-extract mode).
 *
 * Feature detection, preference storage, and the actual Prompt API call live here.
 * Preferences are stored unencrypted in chrome.storage.local since they are
 * device-specific (depends on local hardware/model availability).
 */

import { buildPrompt, parseExtractionResponse } from '@kypflug/transmogrifier-core';
import type { Recipe } from '@kypflug/transmogrifier-core';
import type { AIServiceResponse } from './ai-service';

// ─── Types ────────────────

/** LanguageModel availability status */
export type PromptAPIAvailability = 'available' | 'downloadable' | 'unavailable';

/** On-device preferences stored in chrome.storage.local (unencrypted, device-specific) */
export interface OnDevicePreferences {
  /** User has explicitly enabled/disabled on-device mode */
  enabled: boolean;
  /** Last known availability status */
  lastAvailability: PromptAPIAvailability;
  /** Timestamp of last availability check */
  lastCheckedAt: number;
}

const ON_DEVICE_STORAGE_KEY = 'onDevicePrefs';

const DEFAULT_PREFS: OnDevicePreferences = {
  enabled: true, // On by default when available
  lastAvailability: 'unavailable',
  lastCheckedAt: 0,
};

/** JSON schema for responseConstraint — enforces AIExtractionResponse structure */
const EXTRACTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    excerpt: { type: 'string' },
    author: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['title', 'excerpt', 'author', 'content'],
  additionalProperties: false,
};

// ─── Feature Detection ────────────────

/**
 * Check if the Prompt API (LanguageModel) is available in this browser.
 * Returns 'available' if model is ready, 'downloadable' if it can be downloaded,
 * or 'unavailable' if not supported.
 */
export async function checkPromptAPIAvailability(): Promise<PromptAPIAvailability> {
  try {
    if (typeof LanguageModel === 'undefined') {
      return 'unavailable';
    }

    const availability = await LanguageModel.availability();

    // Edge uses 'available', Chrome uses 'readily'
    if (availability === 'readily' || availability === 'available') return 'available';
    // Edge uses 'downloadable'/'downloading', Chrome uses 'after-download'
    if (availability === 'after-download' || availability === 'downloadable' || availability === 'downloading') return 'downloadable';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// ─── Preferences ────────────────

/**
 * Load on-device preferences from chrome.storage.local.
 */
export async function loadOnDevicePrefs(): Promise<OnDevicePreferences> {
  try {
    const result = await chrome.storage.local.get(ON_DEVICE_STORAGE_KEY);
    return { ...DEFAULT_PREFS, ...result[ON_DEVICE_STORAGE_KEY] };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Save on-device preferences to chrome.storage.local.
 */
export async function saveOnDevicePrefs(prefs: Partial<OnDevicePreferences>): Promise<void> {
  const current = await loadOnDevicePrefs();
  const updated = { ...current, ...prefs };
  await chrome.storage.local.set({ [ON_DEVICE_STORAGE_KEY]: updated });
}

/**
 * Check whether on-device mode should be used for the given recipe.
 * Returns true if: user enabled + API available + recipe is ai-extract.
 */
export async function shouldUseOnDevice(recipeId: string): Promise<boolean> {
  // Only the Fast recipe is supported for on-device mode
  if (recipeId !== 'fast') return false;

  const prefs = await loadOnDevicePrefs();
  if (!prefs.enabled) return false;

  const availability = await checkPromptAPIAvailability();
  // Cache the availability check
  await saveOnDevicePrefs({
    lastAvailability: availability,
    lastCheckedAt: Date.now(),
  });

  return availability === 'available';
}

// ─── Prompt API Call ────────────────

/**
 * Extract and clean content using the browser's on-device Prompt API.
 * Equivalent to extractWithAI() but uses LanguageModel instead of cloud AI.
 */
export async function extractWithPromptAPI(options: {
  recipe: Recipe;
  domContent: string;
  abortSignal?: AbortSignal;
}): Promise<AIServiceResponse> {
  const { recipe, domContent, abortSignal } = options;
  const startTime = Date.now();

  console.log('[Transmogrifier] On-Device Extract - Starting (Prompt API)');

  const { system, user } = buildPrompt(recipe, domContent, undefined, false);

  let session: any;
  try {
    // Create a LanguageModel session with the system prompt
    // Edge uses initialPrompts; systemPrompt is the older Chrome-only shorthand
    session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: system }],
      temperature: 0.3,
      topK: 40,
      signal: abortSignal,
    });

    console.log('[Transmogrifier] On-Device session created, sending prompt...');

    // Send user prompt with response constraint for structured JSON output
    const response = await session.prompt(user, {
      responseConstraint: EXTRACTION_RESPONSE_SCHEMA,
      signal: abortSignal,
    });

    const elapsed = Date.now() - startTime;
    console.log('[Transmogrifier] On-Device extraction response in', (elapsed / 1000).toFixed(1), 's');

    if (!response) {
      return { success: false, error: 'No response from on-device model.', durationMs: elapsed };
    }

    // Parse the JSON response
    const extraction = parseExtractionResponse(response);

    return {
      success: true,
      data: { html: '', extraction } as any,
      durationMs: elapsed,
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: 'Cancelled by user', durationMs: elapsed };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'On-device AI failed',
      durationMs: elapsed,
    };
  } finally {
    // Clean up the session
    if (session?.destroy) {
      session.destroy();
    }
  }
}
