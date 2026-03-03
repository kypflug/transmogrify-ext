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

// ─── Content Chunking ────────────────

/**
 * Max chars per chunk for on-device processing.
 *
 * Edge's Prompt API has a 9,216 token combined context window.
 * Budget per chunk: ~500 system + ~200 template + ~4,000 content + ~4,500 response ≈ 9,200.
 * At ~4 chars/token, 4,000 tokens ≈ 16,000 chars.
 */
const ON_DEVICE_MAX_CHUNK_CHARS = 14000;

/**
 * Split serialized content into chunks that fit the on-device context window.
 * Splits on paragraph boundaries (double newline) to avoid cutting mid-paragraph.
 *
 * The first chunk includes the metadata header (title, author, date, [LEDE]).
 * Subsequent chunks contain only body content.
 */
function chunkContent(serializedContent: string): string[] {
  const blocks = serializedContent.split(/\n\n/);
  const chunks: string[] = [];
  let current = '';

  for (const block of blocks) {
    const candidate = current ? current + '\n\n' + block : block;
    if (candidate.length > ON_DEVICE_MAX_CHUNK_CHARS && current) {
      chunks.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/** JSON schema for body-only chunks (no metadata extraction needed) */
const CHUNK_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    content: { type: 'string' },
  },
  required: ['content'],
  additionalProperties: false,
};

// ─── Prompt API Call ────────────────

/**
 * Extract and clean content using the browser's on-device Prompt API.
 * Long content is automatically chunked to fit within the context window.
 */
export async function extractWithPromptAPI(options: {
  recipe: Recipe;
  domContent: string;
  abortSignal?: AbortSignal;
  onProgress?: (chunk: number, total: number) => void;
}): Promise<AIServiceResponse> {
  const { recipe, domContent, abortSignal, onProgress } = options;
  const startTime = Date.now();

  const chunks = chunkContent(domContent);
  console.log(`[Transmogrifier] On-Device Extract - ${chunks.length} chunk(s), ${domContent.length} chars`);

  let mergedTitle = '';
  let mergedExcerpt = '';
  let mergedAuthor = '';
  const contentParts: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (abortSignal?.aborted) {
      return { success: false, error: 'Cancelled by user', durationMs: Date.now() - startTime };
    }

    onProgress?.(i + 1, chunks.length);

    const isFirstChunk = i === 0;
    const chunkResult = await processChunk({
      recipe,
      chunkContent: chunks[i],
      isFirstChunk,
      abortSignal,
    });

    if (!chunkResult.success) {
      // If the first chunk fails, the whole extraction fails
      if (isFirstChunk) return chunkResult;
      // For subsequent chunks, log and skip
      console.warn(`[Transmogrifier] On-Device chunk ${i + 1}/${chunks.length} failed:`, chunkResult.error);
      continue;
    }

    const extraction = chunkResult.extraction;
    if (isFirstChunk) {
      mergedTitle = extraction.title || '';
      mergedExcerpt = extraction.excerpt || '';
      mergedAuthor = extraction.author || '';
    }

    if (extraction.content?.trim()) {
      contentParts.push(extraction.content);
    } else {
      console.warn(`[Transmogrifier] On-Device chunk ${i + 1}/${chunks.length} returned empty content`);
    }
  }

  const elapsed = Date.now() - startTime;
  const mergedContent = contentParts.join('\n\n');

  if (!mergedContent.trim()) {
    return { success: false, error: 'On-device model returned empty content for all chunks.', durationMs: elapsed };
  }

  console.log(`[Transmogrifier] On-Device extraction complete in ${(elapsed / 1000).toFixed(1)}s (${chunks.length} chunks)`);

  return {
    success: true,
    data: {
      html: '',
      extraction: {
        title: mergedTitle,
        excerpt: mergedExcerpt,
        author: mergedAuthor,
        content: mergedContent,
      },
    } as any,
    durationMs: elapsed,
  };
}

/**
 * Process a single chunk through the Prompt API.
 * First chunk extracts metadata (title, author, excerpt) + content.
 * Subsequent chunks extract content only.
 */
async function processChunk(options: {
  recipe: Recipe;
  chunkContent: string;
  isFirstChunk: boolean;
  abortSignal?: AbortSignal;
}): Promise<{ success: boolean; error?: string; extraction: any }> {
  const { recipe, chunkContent: chunk, isFirstChunk, abortSignal } = options;

  const { system } = buildPrompt(recipe, chunk, undefined, false);

  const userPrompt = isFirstChunk
    ? `Clean this extracted web content for a reading view. Return cleaned content, preserving ALL substantive text in the "content" property. For the "excerpt" property: if the source includes a [LEDE]: line, use that text VERBATIM. If no [LEDE] line is present, generate a 1-2 sentence summary (~280 chars max). Do NOT include the [LEDE] text in the "content" body. Remove web UI debris, duplicate passages, and non-article metadata.\n\n--- BEGIN EXTRACTED CONTENT ---\n\n${chunk}\n\n--- END EXTRACTED CONTENT ---`
    : `Clean this continuation of an article for a reading view. Return ONLY the cleaned content in the "content" property. Remove web UI debris and duplicates. Preserve ALL substantive text.\n\n--- BEGIN CONTENT SEGMENT ---\n\n${chunk}\n\n--- END CONTENT SEGMENT ---`;

  const schema = isFirstChunk ? EXTRACTION_RESPONSE_SCHEMA : CHUNK_RESPONSE_SCHEMA;

  let session: any;
  try {
    session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: system }],
      temperature: 0.3,
      topK: 40,
      signal: abortSignal,
    });

    const response = await session.prompt(userPrompt, {
      responseConstraint: schema,
      signal: abortSignal,
    });

    if (!response) {
      return { success: false, error: 'No response from on-device model.', extraction: {} };
    }

    const extraction = parseExtractionResponse(response);
    return { success: true, extraction };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: 'Cancelled by user', extraction: {} };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'On-device AI failed',
      extraction: {},
    };
  } finally {
    if (session?.destroy) session.destroy();
  }
}
