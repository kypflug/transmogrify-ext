/**
 * Settings Service for Transmogrifier
 *
 * Encryption model:
 *  1. LOCAL: Settings encrypted with a per-device AES-256-GCM key stored in IndexedDB.
 *     Transparent to the user — no passphrase needed for day-to-day use.
 *  2. CLOUD SYNC: Settings encrypted with an identity-derived key (HKDF from Microsoft user ID).
 *     Deterministic: same user ID produces the same key on any device signed into the same account.
 *     No passphrase needed — sync is always available when signed in.
 */

import { encryptWithIdentityKey, decryptWithIdentityKey, decryptLegacyEnvelope, encryptWithKey, decryptWithKey, type SyncEncryptedEnvelope, type LegacyEncryptedEnvelope, type LocalEncryptedEnvelope } from './crypto-service';
import { getDeviceKey, deleteDeviceKey } from './device-key';
import { getUserId } from './auth-service';
import type { AIProvider, ImageProvider } from './config';

// ─── Constants ─────────────

/** Default cloud API URL (Azure Functions) — used for sharing */
const DEFAULT_CLOUD_URL = 'https://transmogrifier-api.azurewebsites.net';

// ─── Types ────────────────

/** Per-provider AI configuration (user-editable) */
export interface AIProviderSettings {
  azureOpenai?: {
    endpoint: string;
    apiKey: string;
    deployment: string;
    apiVersion: string;
  };
  openai?: {
    apiKey: string;
    model: string;
  };
  anthropic?: {
    apiKey: string;
    model: string;
  };
  google?: {
    apiKey: string;
    model: string;
  };
}

/** Per-provider Image configuration (user-editable) */
export interface ImageProviderSettings {
  azureOpenai?: {
    endpoint: string;
    apiKey: string;
    deployment: string;
    apiVersion: string;
  };
  openai?: {
    apiKey: string;
    model: string;
  };
  google?: {
    apiKey: string;
    model: string;
  };
}

/** Cloud processing configuration */
export interface CloudSettings {
  apiUrl: string;
}

/** Sharing storage provider */
export type SharingProvider = 'none' | 'azure-blob';

/** Per-provider sharing configuration */
export interface SharingProviderSettings {
  azureBlob?: {
    accountName: string;
    containerName: string;
    sasToken: string;
  };
}

/** Full settings object */
export interface TransmogrifierSettings {
  /** Schema version for future migrations */
  version: number;
  /** Active AI provider */
  aiProvider: AIProvider;
  /** Per-provider AI config */
  ai: AIProviderSettings;
  /** Active image provider */
  imageProvider: ImageProvider;
  /** Per-provider image config */
  image: ImageProviderSettings;
  /** Cloud processing settings (used by PWA, kept for compat) */
  cloud: CloudSettings;
  /** Active sharing storage provider */
  sharingProvider: SharingProvider;
  /** Per-provider sharing config */
  sharing: SharingProviderSettings;
  /** When these settings were last updated (epoch ms) */
  updatedAt: number;
}

/** What we store in chrome.storage.local (device-key encrypted) */
interface StoredSettings {
  /** Locally-encrypted envelope (device key, no passphrase) */
  envelope: LocalEncryptedEnvelope;
  /** Last sync timestamp (not encrypted — used for conflict resolution) */
  updatedAt: number;
}

// chrome.storage.local keys
const SETTINGS_KEY = 'userSettings';
const SETTINGS_VERSION = 1;

// ─── In-memory cache ────────────────

let cachedSettings: TransmogrifierSettings | null = null;

// ─── Settings CRUD ────────────────

/**
 * Get default (empty) settings
 */
export function getDefaultSettings(): TransmogrifierSettings {
  return {
    version: SETTINGS_VERSION,
    aiProvider: 'azure-openai',
    ai: {},
    imageProvider: 'none',
    image: {},
    cloud: {
      apiUrl: '',
    },
    sharingProvider: 'none',
    sharing: {},
    updatedAt: 0,
  };
}

/**
 * Load and decrypt settings from chrome.storage.local using the device key.
 * No passphrase needed — the device key is auto-generated and stored in IndexedDB.
 * Returns default settings if none exist or decryption fails.
 */
export async function loadSettings(): Promise<TransmogrifierSettings> {
  if (cachedSettings) return cachedSettings;

  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored: StoredSettings | undefined = result[SETTINGS_KEY];

  if (!stored?.envelope) {
    return getDefaultSettings();
  }

  try {
    const key = await getDeviceKey();
    const json = await decryptWithKey(stored.envelope, key);
    const settings = JSON.parse(json) as TransmogrifierSettings;
    cachedSettings = settings;
    return settings;
  } catch (err) {
    console.error('[Settings] Failed to decrypt settings:', err);
    return getDefaultSettings();
  }
}

/**
 * Encrypt and save settings to chrome.storage.local using the device key.
 * No passphrase needed — works immediately after install.
 */
export async function saveSettings(settings: TransmogrifierSettings): Promise<void> {
  settings.updatedAt = Date.now();
  settings.version = SETTINGS_VERSION;

  const key = await getDeviceKey();
  const json = JSON.stringify(settings);
  const envelope = await encryptWithKey(json, key);

  const stored: StoredSettings = {
    envelope,
    updatedAt: settings.updatedAt,
  };

  await chrome.storage.local.set({ [SETTINGS_KEY]: stored });
  cachedSettings = settings;

  console.log('[Settings] Saved settings (device-key encrypted)');
}

/**
 * Clear all settings and device key
 */
export async function clearSettings(): Promise<void> {
  await chrome.storage.local.remove([SETTINGS_KEY]);
  await deleteDeviceKey();
  cachedSettings = null;
}

/**
 * Invalidate in-memory cache (call after sync pull)
 */
export function invalidateCache(): void {
  cachedSettings = null;
}

// ─── Sync helpers ────────────────

/**
 * Get the settings as an identity-key-encrypted envelope for uploading to OneDrive.
 * Requires the user to be signed in (userId needed for key derivation).
 * Returns null if no settings exist or user is not signed in.
 */
export async function getEncryptedEnvelopeForSync(): Promise<{ envelope: SyncEncryptedEnvelope; updatedAt: number } | null> {
  const userId = await getUserId();
  if (!userId) {
    console.warn('[Settings] Cannot prepare sync envelope: not signed in');
    return null;
  }

  const settings = await loadSettings();
  if (settings.updatedAt === 0) return null; // default/empty settings

  // Encrypt with identity-derived key (HKDF from userId)
  const json = JSON.stringify(settings);
  const envelope = await encryptWithIdentityKey(json, userId);

  return { envelope, updatedAt: settings.updatedAt };
}

/**
 * Import an encrypted envelope from OneDrive.
 * Supports both v2 (identity key) and v1 (legacy passphrase) envelopes.
 * For v1 envelopes, a passphrase must be provided for migration.
 * Decrypts, then re-encrypts with the device key for local storage.
 * Returns true if successful, false on failure.
 */
export async function importEncryptedEnvelope(
  envelope: SyncEncryptedEnvelope | LegacyEncryptedEnvelope,
  remoteUpdatedAt: number,
  legacyPassphrase?: string,
): Promise<boolean> {
  // Check if local is newer
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const local: StoredSettings | undefined = result[SETTINGS_KEY];
  if (local && local.updatedAt >= remoteUpdatedAt) {
    console.log('[Settings] Local settings are newer, skipping import');
    return true; // Not an error — just no-op
  }

  let settings: TransmogrifierSettings;

  if (envelope.v === 2) {
    // v2: identity-key encrypted
    const userId = await getUserId();
    if (!userId) {
      console.warn('[Settings] Cannot import: not signed in');
      return false;
    }
    try {
      const json = await decryptWithIdentityKey(envelope, userId);
      settings = JSON.parse(json) as TransmogrifierSettings;
    } catch (err) {
      console.error('[Settings] Failed to decrypt cloud settings:', err);
      return false;
    }
  } else if (envelope.v === 1) {
    // v1: legacy passphrase-encrypted (migration path)
    if (!legacyPassphrase) {
      console.warn('[Settings] Cannot import v1 envelope without passphrase');
      return false;
    }
    try {
      const json = await decryptLegacyEnvelope(envelope as LegacyEncryptedEnvelope, legacyPassphrase);
      settings = JSON.parse(json) as TransmogrifierSettings;
    } catch (err) {
      console.error('[Settings] Failed to decrypt legacy settings (wrong passphrase?):', err);
      return false;
    }
  } else {
    console.error('[Settings] Unknown envelope version:', (envelope as { v: number }).v);
    return false;
  }

  // Re-encrypt with device key and store locally
  const deviceKey = await getDeviceKey();
  const localEnvelope = await encryptWithKey(JSON.stringify(settings), deviceKey);
  const stored: StoredSettings = { envelope: localEnvelope, updatedAt: settings.updatedAt };
  await chrome.storage.local.set({ [SETTINGS_KEY]: stored });
  cachedSettings = settings;

  console.log('[Settings] Imported settings from cloud (re-encrypted with device key)');
  return true;
}

// ─── Config resolution (from encrypted user settings) ────────────────

/**
 * Resolve the effective AI config from user settings.
 * Returns the config in the same shape as config.ts types.
 */
export async function getEffectiveAIConfig(): Promise<{
  provider: AIProvider;
  endpoint?: string;
  apiKey: string;
  deployment?: string;
  apiVersion?: string;
  model?: string;
} | null> {
  const settings = await loadSettings();

  // If user has configured the active provider, use it
  const provider = settings.aiProvider;
  const providerSettings = getAIProviderConfig(settings, provider);

  if (providerSettings && providerSettings.apiKey) {
    return providerSettings;
  }

  // No user settings configured
  return null;
}

/**
 * Resolve the effective image config from user settings
 */
export async function getEffectiveImageConfig(): Promise<{
  provider: ImageProvider;
  endpoint?: string;
  apiKey?: string;
  deployment?: string;
  apiVersion?: string;
  model?: string;
} | null> {
  const settings = await loadSettings();
  const provider = settings.imageProvider;

  if (provider === 'none') return null;

  const providerSettings = getImageProviderConfig(settings, provider);
  if (providerSettings && providerSettings.apiKey) {
    return providerSettings;
  }

  return null;
}

/**
 * Resolve the effective cloud API URL (used for sharing).
 */
export async function getEffectiveCloudUrl(): Promise<string> {
  const settings = await loadSettings();
  return settings.cloud.apiUrl || DEFAULT_CLOUD_URL;
}

/**
 * Resolve the effective sharing config (BYOS).
 * Returns null if sharing is disabled or not configured.
 */
export async function getEffectiveSharingConfig(): Promise<{
  provider: SharingProvider;
  accountName: string;
  containerName: string;
  sasToken: string;
} | null> {
  const settings = await loadSettings();
  if (settings.sharingProvider === 'none') return null;

  if (settings.sharingProvider === 'azure-blob') {
    const c = settings.sharing.azureBlob;
    if (!c?.accountName || !c?.containerName || !c?.sasToken) return null;
    return {
      provider: 'azure-blob',
      accountName: c.accountName,
      containerName: c.containerName,
      sasToken: c.sasToken,
    };
  }

  return null;
}

/**
 * Get the AI config to send to the cloud function.
 * Always returns the user's configured AI keys (required for cloud processing).
 * Returns null only if no AI provider is configured.
 * Note: Used by the PWA via settings sync; extension processes locally.
 */
export async function getCloudAIConfig(): Promise<{
  provider: AIProvider;
  endpoint?: string;
  apiKey: string;
  deployment?: string;
  apiVersion?: string;
  model?: string;
} | null> {
  const settings = await loadSettings();

  return getAIProviderConfig(settings, settings.aiProvider);
}

// ─── Internal helpers ────────────────

function getAIProviderConfig(
  settings: TransmogrifierSettings,
  provider: AIProvider,
): { provider: AIProvider; endpoint?: string; apiKey: string; deployment?: string; apiVersion?: string; model?: string } | null {
  switch (provider) {
    case 'azure-openai': {
      const c = settings.ai.azureOpenai;
      if (!c?.apiKey) return null;
      return { provider, endpoint: c.endpoint, apiKey: c.apiKey, deployment: c.deployment, apiVersion: c.apiVersion };
    }
    case 'openai': {
      const c = settings.ai.openai;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
    case 'anthropic': {
      const c = settings.ai.anthropic;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
    case 'google': {
      const c = settings.ai.google;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
  }
}

function getImageProviderConfig(
  settings: TransmogrifierSettings,
  provider: ImageProvider,
): { provider: ImageProvider; endpoint?: string; apiKey: string; deployment?: string; apiVersion?: string; model?: string } | null {
  switch (provider) {
    case 'azure-openai': {
      const c = settings.image.azureOpenai;
      if (!c?.apiKey) return null;
      return { provider, endpoint: c.endpoint, apiKey: c.apiKey, deployment: c.deployment, apiVersion: c.apiVersion };
    }
    case 'openai': {
      const c = settings.image.openai;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
    case 'google': {
      const c = settings.image.google;
      if (!c?.apiKey) return null;
      return { provider, apiKey: c.apiKey, model: c.model };
    }
    case 'none':
      return null;
  }
}
