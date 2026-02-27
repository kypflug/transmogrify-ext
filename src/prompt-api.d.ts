/**
 * Type declarations for the browser Prompt API (LanguageModel).
 * Available in Edge 138+ and Chrome Canary with appropriate flags.
 * @see https://github.com/nicolo-ribaudo/tc39-proposal-built-in-modules/blob/main/explainer/prompt-api.md
 */

interface LanguageModelCreateOptions {
  systemPrompt?: string;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
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
  availability(): Promise<'readily' | 'after-download' | 'no'>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare const LanguageModel: LanguageModelConstructor;
