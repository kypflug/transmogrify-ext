/**
 * AI Service for Cloud Transmogrification
 * 
 * Server-side equivalent of the extension's ai-service.ts.
 * Calls the user-provided AI provider to generate HTML from extracted content.
 * 
 * The server has NO AI keys of its own — users must provide their own
 * API keys via encrypted settings in the extension/PWA.
 */

import { AIResponse, UserAIConfig } from './types.js';
import { buildCloudPrompt } from './recipes.js';

type AIProvider = 'azure-openai' | 'openai' | 'anthropic' | 'google';

interface AIConfig {
  provider: AIProvider;
  endpoint?: string;
  apiKey: string;
  deployment?: string;
  apiVersion?: string;
  model?: string;
}

/**
 * Convert a UserAIConfig (from the client) into our internal AIConfig shape.
 */
function userConfigToAIConfig(userConfig: UserAIConfig): AIConfig {
  return {
    provider: userConfig.provider,
    endpoint: userConfig.endpoint,
    apiKey: userConfig.apiKey,
    deployment: userConfig.deployment,
    apiVersion: userConfig.apiVersion,
    model: userConfig.model,
  };
}

/**
 * Call the AI provider to generate HTML using user-provided keys.
 */
export async function generateHTML(
  recipeId: string,
  content: string,
  customPrompt: string | undefined,
  userAIConfig: UserAIConfig,
): Promise<AIResponse> {
  const config = userConfigToAIConfig(userAIConfig);

  if (!config.apiKey) {
    throw new Error(`AI provider ${config.provider} is not configured (missing API key)`);
  }

  const { system, user } = buildCloudPrompt(recipeId, content, customPrompt);
  const maxTokens = 32768;

  let responseText: string;

  switch (config.provider) {
    case 'azure-openai':
      responseText = await callAzureOpenAI(config, system, user, maxTokens);
      break;
    case 'openai':
      responseText = await callOpenAI(config, system, user, maxTokens);
      break;
    case 'anthropic':
      responseText = await callAnthropic(config, system, user, maxTokens);
      break;
    case 'google':
      responseText = await callGoogle(config, system, user, maxTokens);
      break;
  }

  return parseAIResponse(responseText);
}

// ─── Provider implementations ────────────────

async function callAzureOpenAI(
  config: AIConfig, system: string, user: string, maxTokens: number
): Promise<string> {
  const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTokens,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Azure OpenAI error ${res.status}: ${body}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content || '';
}

async function callOpenAI(
  config: AIConfig, system: string, user: string, maxTokens: number
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: maxTokens,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${body}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content || '';
}

async function callAnthropic(
  config: AIConfig, system: string, user: string, maxTokens: number
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${body}`);
  }

  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text || '';
}

async function callGoogle(
  config: AIConfig, system: string, user: string, maxTokens: number
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google AI error ${res.status}: ${body}`);
  }

  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates[0]?.content?.parts[0]?.text || '';
}

// ─── Response parsing ────────────────

function parseAIResponse(raw: string): AIResponse {
  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(raw);
    if (parsed.html) {
      return { html: parsed.html, explanation: parsed.explanation };
    }
  } catch {
    // Not valid JSON — try to extract JSON from markdown code blocks
  }

  // Try extracting JSON from code block
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.html) {
        return { html: parsed.html, explanation: parsed.explanation };
      }
    } catch {
      // Fall through
    }
  }

  // Try extracting raw HTML
  const htmlMatch = raw.match(/<!DOCTYPE html[\s\S]*<\/html>/i);
  if (htmlMatch) {
    return { html: htmlMatch[0] };
  }

  throw new Error('Could not parse AI response — no HTML found');
}
