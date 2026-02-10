/**
 * Settings Service for Transmogrifier
 *
 * Two-tier encryption model:
 *  1. LOCAL: Settings encrypted with a per-device AES-256-GCM key stored in IndexedDB.
 *     Transparent to the user — no passphrase needed for day-to-day use.
 *  2. CLOUD SYNC: Settings encrypted with a user-chosen passphrase (PBKDF2 + AES-256-GCM).
 *     The passphrase is entered once per device to enable OneDrive sync.
 *     The same passphrase decrypts settings on any device (extension or PWA).
 *
 * The passphrase is held in memory only while needed for sync operations, then discarded.
 */

import { encrypt, decrypt, encryptWithKey, decryptWithKey, type EncryptedEnvelope, type LocalEncryptedEnvelope } from './crypto-service';
import { getDeviceKey, deleteDeviceKey } from './device-key';
import type { AIProvider, ImageProvider } from './config';

// ─── Constants ─────────────

/** Default cloud API URL (Azure Functions) */
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
  /** Cloud processing settings */
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
const SYNC_PASSPHRASE_KEY = 'syncPassphrase';
const SETTINGS_VERSION = 1;

// ─── In-memory cache ────────────────

let cachedSettings: TransmogrifierSettings | null = null;

/**
 * Sync passphrase — held in memory only.
 * Used exclusively for encrypting/decrypting the OneDrive cloud envelope.
 * Not needed for local settings access.
 */
let syncPassphrase: string | null = null;

// ─── Sync passphrase management ────────────────

/**
 * Get the sync passphrase (memory-only).
 * Falls back to chrome.storage.session for service-worker persistence.
 */
export async function getSyncPassphrase(): Promise<string | null> {
  if (syncPassphrase) return syncPassphrase;
  try {
    const result = await chrome.storage.session.get(SYNC_PASSPHRASE_KEY);
    syncPassphrase = result[SYNC_PASSPHRASE_KEY] || null;
  } catch {
    // chrome.storage.session may not be available in all contexts
  }
  return syncPassphrase;
}

/**
 * Set the sync passphrase (used for OneDrive encrypted sync).
 * Stored in chrome.storage.session so it survives service-worker restarts
 * but is cleared when the browser closes.
 */
export async function setSyncPassphrase(passphrase: string): Promise<void> {
  syncPassphrase = passphrase;
  try {
    await chrome.storage.session.set({ [SYNC_PASSPHRASE_KEY]: passphrase });
  } catch {
    console.warn('[Settings] chrome.storage.session unavailable, passphrase in memory only');
  }
}

/**
 * Check if a sync passphrase is currently available
 */
export async function hasSyncPassphrase(): Promise<boolean> {
  const pp = await getSyncPassphrase();
  return !!pp;
}

/**
 * Clear the sync passphrase from memory and session storage
 */
export async function clearSyncPassphrase(): Promise<void> {
  syncPassphrase = null;
  try {
    await chrome.storage.session.remove([SYNC_PASSPHRASE_KEY]);
  } catch {
    // session storage may not be available
  }
}

// ─── Legacy passphrase compat (delegates to sync passphrase) ────────────────
// These aliases keep existing callers working during the transition.

/** @deprecated Use getSyncPassphrase() */
export const getPassphrase = getSyncPassphrase;
/** @deprecated Use setSyncPassphrase() */
export const setPassphrase = setSyncPassphrase;
/** @deprecated Use hasSyncPassphrase() */
export const hasPassphrase = hasSyncPassphrase;

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
 * Clear all settings, device key, and sync passphrase
 */
export async function clearSettings(): Promise<void> {
  await chrome.storage.local.remove([SETTINGS_KEY]);
  await clearSyncPassphrase();
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
 * Get the settings as a passphrase-encrypted envelope for uploading to OneDrive.
 * Requires a sync passphrase to be set.
 * Returns null if no settings exist or no passphrase is available.
 */
export async function getEncryptedEnvelopeForSync(): Promise<{ envelope: EncryptedEnvelope; updatedAt: number } | null> {
  const passphrase = await getSyncPassphrase();
  if (!passphrase) {
    console.warn('[Settings] Cannot prepare sync envelope: no sync passphrase set');
    return null;
  }

  const settings = await loadSettings();
  if (settings.updatedAt === 0) return null; // default/empty settings

  // Re-encrypt with passphrase for cloud storage
  const json = JSON.stringify(settings);
  const envelope = await encrypt(json, passphrase);

  return { envelope, updatedAt: settings.updatedAt };
}

/**
 * Import a passphrase-encrypted envelope from OneDrive.
 * Decrypts with the sync passphrase, then re-encrypts with the device key for local storage.
 * Returns true if successful, false if passphrase mismatch or missing.
 */
export async function importEncryptedEnvelope(
  envelope: EncryptedEnvelope,
  remoteUpdatedAt: number,
): Promise<boolean> {
  const passphrase = await getSyncPassphrase();
  if (!passphrase) {
    console.warn('[Settings] Cannot import: no sync passphrase set');
    return false;
  }

  // Check if local is newer
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const local: StoredSettings | undefined = result[SETTINGS_KEY];
  if (local && local.updatedAt >= remoteUpdatedAt) {
    console.log('[Settings] Local settings are newer, skipping import');
    return true; // Not an error — just no-op
  }

  // Decrypt with passphrase
  let settings: TransmogrifierSettings;
  try {
    const json = await decrypt(envelope, passphrase);
    settings = JSON.parse(json) as TransmogrifierSettings;
  } catch (err) {
    console.error('[Settings] Failed to decrypt cloud settings (wrong passphrase?):', err);
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
 * Resolve the effective cloud API URL
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
