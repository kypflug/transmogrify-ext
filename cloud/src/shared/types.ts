/**
 * Shared types for the Transmogrifier Cloud API
 */

/** User-provided AI config (always required — no server-side keys) */
export interface UserAIConfig {
  provider: 'azure-openai' | 'openai' | 'anthropic' | 'google';
  endpoint?: string;
  apiKey: string;
  deployment?: string;
  apiVersion?: string;
  model?: string;
}

/** A queued transmogrification job */
export interface TransmogrifyJob {
  jobId: string;
  url: string;
  recipeId: string;
  customPrompt?: string;
  /** User's Microsoft Graph access token (delegated, Files.ReadWrite.AppFolder) */
  accessToken: string;
  /** User-provided AI config (required — server has no AI keys) */
  aiConfig: UserAIConfig;
  /** User-provided image config (optional — for image-enabled recipes) */
  imageConfig?: UserImageConfig;
  /** When the job was queued */
  queuedAt: number;
}

/** Job status stored in table/queue metadata */
export type JobStatus = 'queued' | 'processing' | 'complete' | 'failed';

export interface JobResult {
  jobId: string;
  status: JobStatus;
  articleId?: string;
  error?: string;
  completedAt?: number;
}

/** OneDrive article metadata — must match extension's OneDriveArticleMeta exactly */
export interface OneDriveArticleMeta {
  id: string;
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
  size: number;
}

/** Image placeholder from AI response (for image-enabled recipes) */
export interface ImagePlaceholder {
  id: string;
  prompt: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024';
  style?: 'natural' | 'vivid';
  altText: string;
  placement: 'hero' | 'inline' | 'background' | 'accent';
}

/** AI provider response */
export interface AIResponse {
  html: string;
  images?: ImagePlaceholder[];
  explanation?: string;
}

/** User-provided image generation config */
export interface UserImageConfig {
  provider: 'azure-openai' | 'openai' | 'google' | 'none';
  endpoint?: string;
  apiKey?: string;
  deployment?: string;
  apiVersion?: string;
  model?: string;
}

/** Queue request body from the client */
export interface QueueRequest {
  url: string;
  recipeId: string;
  accessToken: string;
  customPrompt?: string;
  /** User-provided AI config (required — server has no AI keys) */
  aiConfig: UserAIConfig;
  /** User-provided image config (optional — for image-enabled recipes) */
  imageConfig?: UserImageConfig;
}
