/**
 * Shared types for Transmogrifier extension
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
  type: 
    | 'EXTRACT_CONTENT' 
    | 'GET_STATUS' 
    | 'UPDATE_SETTINGS' 
    | 'AI_ANALYZE' 
    | 'GET_PROGRESS' 
    | 'RESET_PROGRESS'
    | 'GET_ARTICLES'
    | 'GET_ARTICLE'
    | 'DELETE_ARTICLE'
    | 'TOGGLE_FAVORITE'
    | 'EXPORT_ARTICLE'
    | 'GET_STORAGE_STATS'
    | 'OPEN_ARTICLE'
    | 'RESPIN_ARTICLE'
    | 'GET_ACTIVE_REMIXES'
    | 'CANCEL_REMIX'
    | 'CLEAR_STALE_REMIXES';
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
  articleId?: string; // For article operations
  requestId?: string; // For parallel remix tracking
}

/** Response from content script */
export interface RemixResponse {
  success: boolean;
  currentMode?: RemixMode;
  error?: string;
  aiExplanation?: string;
  domContent?: string;
  filePath?: string;
  progress?: RemixProgressState;
  articleId?: string;
  articles?: import('./storage-service').ArticleSummary[];
  article?: import('./storage-service').SavedArticle;
  isFavorite?: boolean;
  stats?: { count: number; totalSize: number };
  requestId?: string; // For parallel remix tracking
  activeRemixes?: RemixRequest[]; // For GET_ACTIVE_REMIXES
  cleaned?: number; // For CLEAR_STALE_REMIXES
}

/** Status of a remix operation */
export type RemixStatus = 'idle' | 'extracting' | 'analyzing' | 'generating-images' | 'saving' | 'complete' | 'error';

/** A single remix request for parallel tracking */
export interface RemixRequest {
  requestId: string;
  tabId: number;
  status: RemixStatus;
  step: string;
  startTime: number;
  pageTitle: string;
  recipeId: string;
  error?: string;
  articleId?: string;
  warning?: string; // Set when remix is taking unusually long
}

/** Progress state for resilient operations */
export interface RemixProgressState {
  status: 'idle' | 'extracting' | 'analyzing' | 'generating-images' | 'saving' | 'complete' | 'error';
  step: string;
  error?: string;
  startTime?: number;
  pageTitle?: string;
  recipeId?: string;
  explanation?: string;
  articleId?: string;
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
