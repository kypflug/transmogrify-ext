/**
 * Shared types for Focus Remix extension
 */

import { AIResponse } from './recipes';

/** Available remix modes - now recipe-based */
export type RemixMode = 'off' | 'ai';

/** User preferences stored in chrome.storage */
export interface UserPreferences {
  mode: RemixMode;
  selectedRecipe: string;  // Recipe ID
  customPrompt: string;    // For custom recipe
  readerSettings: ReaderSettings;
  enabledSites: string[];
  disabledSites: string[];
}

/** Settings for Focus Mode */
export interface FocusSettings {
  hideAds: boolean;
  hideSidebars: boolean;
  hideFooters: boolean;
  hideComments: boolean;
  dimBackground: boolean;
  centerContent: boolean;
}

/** Settings for Reader Mode */
export interface ReaderSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
  theme: 'light' | 'dark' | 'sepia';
  justifyText: boolean;
}

/** Message types for extension communication */
export interface RemixMessage {
  type: 'APPLY_REMIX' | 'REMOVE_REMIX' | 'GET_STATUS' | 'UPDATE_SETTINGS' | 'AI_ANALYZE';
  payload?: RemixPayload;
}

/** Generated image data to pass to content script */
export interface GeneratedImageData {
  id: string;
  dataUrl: string;
  altText: string;
}

export interface RemixPayload {
  mode?: RemixMode;
  recipeId?: string;
  customPrompt?: string;
  domContent?: string;
  aiResponse?: AIResponse;
  generatedImages?: GeneratedImageData[];
  generateImages?: boolean;
  settings?: Partial<UserPreferences>;
}

/** Response from content script */
export interface RemixResponse {
  success: boolean;
  currentMode?: RemixMode;
  error?: string;
  aiExplanation?: string;
  domContent?: string;
}

/** Default preferences */
export const DEFAULT_PREFERENCES: UserPreferences = {
  mode: 'off',
  selectedRecipe: 'focus',
  customPrompt: '',
  readerSettings: {
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    lineHeight: 1.6,
    maxWidth: 700,
    theme: 'light',
    justifyText: false,
  },
  enabledSites: [],
  disabledSites: [],
};
