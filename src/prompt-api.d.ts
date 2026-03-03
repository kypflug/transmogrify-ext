/**
 * Type declarations for the browser Prompt API (LanguageModel).
 * Available in Edge 138+ and Chrome Canary with appropriate flags.
 * @see https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api
 */

interface LanguageModelInitialPrompt {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LanguageModelCreateOptions {
  /** System prompt (Chrome shorthand — prefer initialPrompts for cross-browser support) */
  systemPrompt?: string;
  /** Initial prompts including system prompt (Edge + Chrome) */
  initialPrompts?: LanguageModelInitialPrompt[];
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
  monitor?: (monitor: EventTarget) => void;
}

interface LanguageModelPromptOptions {
  responseConstraint?: object;
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string, options?: LanguageModelPromptOptions): ReadableStream<string>;
  destroy(): void;
}

interface LanguageModelConstructor {
  /** Chrome returns 'readily'|'after-download'|'no'; Edge returns 'available'|'downloadable'|'downloading'|'unavailable' */
  availability(): Promise<string>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare const LanguageModel: LanguageModelConstructor;
