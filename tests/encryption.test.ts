/**
 * Tests for the two-tier encryption system:
 *  - crypto-service.ts (passphrase + device-key modes)
 *  - device-key.ts (CryptoKey generation & persistence)
 *  - settings-service.ts (load/save/sync with both tiers)
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── crypto-service tests ────────────────

describe('crypto-service', () => {
  let encrypt: typeof import('../src/shared/crypto-service').encrypt;
  let decrypt: typeof import('../src/shared/crypto-service').decrypt;
  let encryptWithKey: typeof import('../src/shared/crypto-service').encryptWithKey;
  let decryptWithKey: typeof import('../src/shared/crypto-service').decryptWithKey;

  beforeEach(async () => {
    const mod = await import('../src/shared/crypto-service');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
    encryptWithKey = mod.encryptWithKey;
    decryptWithKey = mod.decryptWithKey;
  });

  describe('passphrase-based (PBKDF2)', () => {
    it('encrypt then decrypt round-trips correctly', async () => {
      const plaintext = JSON.stringify({ apiKey: 'sk-test-12345', model: 'gpt-4o' });
      const passphrase = 'my-strong-passphrase!';

      const envelope = await encrypt(plaintext, passphrase);

      expect(envelope.v).toBe(1);
      expect(envelope.salt).toBeTruthy();
      expect(envelope.iv).toBeTruthy();
      expect(envelope.data).toBeTruthy();
      // Ciphertext should not contain the plaintext
      expect(envelope.data).not.toContain('sk-test');

      const decrypted = await decrypt(envelope, passphrase);
      expect(decrypted).toBe(plaintext);
    });

    it('wrong passphrase throws', async () => {
      const envelope = await encrypt('secret data', 'correct-passphrase');
      await expect(decrypt(envelope, 'wrong-passphrase')).rejects.toThrow();
    });

    it('tampered ciphertext throws', async () => {
      const envelope = await encrypt('hello world', 'passphrase');
      // Flip a character in the ciphertext
      const tampered = { ...envelope, data: envelope.data.slice(0, -2) + 'AA' };
      await expect(decrypt(tampered, 'passphrase')).rejects.toThrow();
    });

    it('produces unique salt and IV each time', async () => {
      const e1 = await encrypt('same data', 'same-pass');
      const e2 = await encrypt('same data', 'same-pass');
      expect(e1.salt).not.toBe(e2.salt);
      expect(e1.iv).not.toBe(e2.iv);
      expect(e1.data).not.toBe(e2.data);
    });

    it('handles empty string', async () => {
      const envelope = await encrypt('', 'passphrase');
      const decrypted = await decrypt(envelope, 'passphrase');
      expect(decrypted).toBe('');
    });

    it('handles unicode content', async () => {
      const text = '日本語テスト 🔑 Ελληνικά';
      const envelope = await encrypt(text, 'passphrase');
      const decrypted = await decrypt(envelope, 'passphrase');
      expect(decrypted).toBe(text);
    });

    it('handles large payloads', async () => {
      const large = JSON.stringify({ data: 'x'.repeat(100_000) });
      const envelope = await encrypt(large, 'passphrase');
      const decrypted = await decrypt(envelope, 'passphrase');
      expect(decrypted).toBe(large);
    });
  });

  describe('device-key-based (CryptoKey)', () => {
    let deviceKey: CryptoKey;

    beforeEach(async () => {
      deviceKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    });

    it('encrypt then decrypt round-trips correctly', async () => {
      const plaintext = JSON.stringify({ apiKey: 'sk-test-67890' });
      const envelope = await encryptWithKey(plaintext, deviceKey);

      expect(envelope.v).toBe(1);
      expect(envelope.iv).toBeTruthy();
      expect(envelope.data).toBeTruthy();
      // LocalEncryptedEnvelope should not have salt
      expect((envelope as any).salt).toBeUndefined();
      expect(envelope.data).not.toContain('sk-test');

      const decrypted = await decryptWithKey(envelope, deviceKey);
      expect(decrypted).toBe(plaintext);
    });

    it('wrong key throws', async () => {
      const envelope = await encryptWithKey('secret', deviceKey);
      const wrongKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      await expect(decryptWithKey(envelope, wrongKey)).rejects.toThrow();
    });

    it('produces unique IV each time', async () => {
      const e1 = await encryptWithKey('data', deviceKey);
      const e2 = await encryptWithKey('data', deviceKey);
      expect(e1.iv).not.toBe(e2.iv);
    });

    it('handles unicode content', async () => {
      const text = '密钥测试 🎨 مفتاح';
      const envelope = await encryptWithKey(text, deviceKey);
      const decrypted = await decryptWithKey(envelope, deviceKey);
      expect(decrypted).toBe(text);
    });
  });

  describe('cross-mode isolation', () => {
    it('passphrase envelope cannot be decrypted with device key', async () => {
      const deviceKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      const passphraseEnv = await encrypt('secret', 'passphrase');
      // Force-cast to LocalEncryptedEnvelope shape
      await expect(decryptWithKey(passphraseEnv as any, deviceKey)).rejects.toThrow();
    });
  });
});

// ─── device-key tests ────────────────

describe('device-key', () => {
  beforeEach(() => {
    // Clear fake-indexeddb between tests
    indexedDB = new IDBFactory();
  });

  it('generates a key on first call', async () => {
    // Dynamic import to get fresh module state
    const { getDeviceKey } = await import('../src/shared/device-key');
    const key = await getDeviceKey();

    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.type).toBe('secret');
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(key.extractable).toBe(false);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('returns the same key on subsequent calls', async () => {
    const mod = await import('../src/shared/device-key');
    const key1 = await mod.getDeviceKey();
    const key2 = await mod.getDeviceKey();
    // Same object reference (cached)
    expect(key1).toBe(key2);
  });

  it('deleteDeviceKey removes the key', async () => {
    const { getDeviceKey, deleteDeviceKey } = await import('../src/shared/device-key');
    const key1 = await getDeviceKey();
    expect(key1).toBeTruthy();

    await deleteDeviceKey();

    // After delete, a NEW key should be generated
    const key2 = await getDeviceKey();
    expect(key2).toBeTruthy();
    expect(key2).not.toBe(key1);
  });

  it('device key works with encryptWithKey/decryptWithKey', async () => {
    const { getDeviceKey } = await import('../src/shared/device-key');
    const { encryptWithKey, decryptWithKey } = await import('../src/shared/crypto-service');

    const key = await getDeviceKey();
    const plaintext = '{"apiKey":"sk-abc123"}';

    const envelope = await encryptWithKey(plaintext, key);
    const decrypted = await decryptWithKey(envelope, key);

    expect(decrypted).toBe(plaintext);
  });
});

// ─── settings-service tests ────────────────

describe('settings-service', () => {
  // Mock chrome.storage.local and chrome.storage.session
  const localStore: Record<string, any> = {};
  const sessionStore: Record<string, any> = {};

  beforeEach(() => {
    // Reset stores
    Object.keys(localStore).forEach(k => delete localStore[k]);
    Object.keys(sessionStore).forEach(k => delete sessionStore[k]);

    // Reset fake-indexeddb
    indexedDB = new IDBFactory();

    // Mock chrome.storage
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const result: Record<string, any> = {};
            const keyArr = Array.isArray(keys) ? keys : [keys];
            for (const k of keyArr) {
              if (localStore[k] !== undefined) result[k] = localStore[k];
            }
            return result;
          }),
          set: vi.fn(async (items: Record<string, any>) => {
            Object.assign(localStore, items);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            for (const k of keyArr) delete localStore[k];
          }),
        },
        session: {
          get: vi.fn(async (keys: string | string[]) => {
            const result: Record<string, any> = {};
            const keyArr = Array.isArray(keys) ? keys : [keys];
            for (const k of keyArr) {
              if (sessionStore[k] !== undefined) result[k] = sessionStore[k];
            }
            return result;
          }),
          set: vi.fn(async (items: Record<string, any>) => {
            Object.assign(sessionStore, items);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const keyArr = Array.isArray(keys) ? keys : [keys];
            for (const k of keyArr) delete sessionStore[k];
          }),
        },
      },
    };
  });

  it('loadSettings returns defaults when nothing is saved', async () => {
    const { loadSettings, getDefaultSettings, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();
    const settings = await loadSettings();
    const defaults = getDefaultSettings();
    expect(settings.version).toBe(defaults.version);
    expect(settings.aiProvider).toBe(defaults.aiProvider);
    expect(settings.updatedAt).toBe(0);
  });

  it('saveSettings + loadSettings round-trips', async () => {
    const { loadSettings, saveSettings, invalidateCache, getDefaultSettings } = await import('../src/shared/settings-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.aiProvider = 'openai';
    settings.ai = {
      openai: { apiKey: 'sk-test-round-trip', model: 'gpt-4o' },
    };
    settings.cloud = { apiUrl: 'https://my-func.azurewebsites.net' };

    await saveSettings(settings);
    invalidateCache(); // Force re-read from storage

    const loaded = await loadSettings();
    expect(loaded.aiProvider).toBe('openai');
    expect(loaded.ai.openai?.apiKey).toBe('sk-test-round-trip');
    expect(loaded.ai.openai?.model).toBe('gpt-4o');
    expect(loaded.cloud.apiUrl).toBe('https://my-func.azurewebsites.net');
    expect(loaded.updatedAt).toBeGreaterThan(0);
  });

  it('saveSettings does not require a passphrase', async () => {
    const { saveSettings, getDefaultSettings, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.ai = { google: { apiKey: 'AIzaTest', model: 'gemini-2.0-flash' } };

    // Should NOT throw — device key encryption doesn't need a passphrase
    await expect(saveSettings(settings)).resolves.not.toThrow();
  });

  it('saved data is encrypted in chrome.storage.local', async () => {
    const { saveSettings, getDefaultSettings, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.ai = { openai: { apiKey: 'sk-super-secret', model: 'gpt-4o' } };
    await saveSettings(settings);

    // Check what's actually in the store
    const raw = localStore['userSettings'];
    expect(raw).toBeTruthy();
    expect(raw.envelope).toBeTruthy();
    expect(raw.envelope.v).toBe(1);
    expect(raw.envelope.iv).toBeTruthy();
    expect(raw.envelope.data).toBeTruthy();
    // The raw data should NOT contain the API key in plaintext
    expect(JSON.stringify(raw)).not.toContain('sk-super-secret');
  });

  it('clearSettings removes everything', async () => {
    const { saveSettings, loadSettings, clearSettings, getDefaultSettings, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.ai = { openai: { apiKey: 'sk-will-delete', model: 'gpt-4o' } };
    await saveSettings(settings);

    await clearSettings();
    invalidateCache();

    const loaded = await loadSettings();
    expect(loaded.updatedAt).toBe(0);
    expect(loaded.ai.openai).toBeUndefined();
    expect(localStore['userSettings']).toBeUndefined();
  });

  it('sync passphrase is independent of local save/load', async () => {
    const { hasSyncPassphrase, setSyncPassphrase, getSyncPassphrase, clearSyncPassphrase, saveSettings, loadSettings, getDefaultSettings, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();

    // No passphrase needed to save
    const settings = getDefaultSettings();
    settings.ai = { anthropic: { apiKey: 'sk-ant-test', model: 'claude-sonnet-4-20250514' } };
    await saveSettings(settings);

    expect(await hasSyncPassphrase()).toBe(false);

    // Set sync passphrase
    await setSyncPassphrase('my-sync-pass');
    expect(await hasSyncPassphrase()).toBe(true);
    expect(await getSyncPassphrase()).toBe('my-sync-pass');

    // Load still works (uses device key, not passphrase)
    invalidateCache();
    const loaded = await loadSettings();
    expect(loaded.ai.anthropic?.apiKey).toBe('sk-ant-test');

    // Clear passphrase
    await clearSyncPassphrase();
    expect(await hasSyncPassphrase()).toBe(false);

    // Load STILL works (device key, not passphrase)
    invalidateCache();
    const loaded2 = await loadSettings();
    expect(loaded2.ai.anthropic?.apiKey).toBe('sk-ant-test');
  });

  it('getEncryptedEnvelopeForSync requires sync passphrase', async () => {
    const { saveSettings, getDefaultSettings, getEncryptedEnvelopeForSync, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.ai = { openai: { apiKey: 'sk-sync-test', model: 'gpt-4o' } };
    await saveSettings(settings);

    // Without passphrase → null
    const result = await getEncryptedEnvelopeForSync();
    expect(result).toBeNull();
  });

  it('getEncryptedEnvelopeForSync produces passphrase-encrypted envelope', async () => {
    const { saveSettings, getDefaultSettings, getEncryptedEnvelopeForSync, setSyncPassphrase, invalidateCache } = await import('../src/shared/settings-service');
    const { decrypt } = await import('../src/shared/crypto-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.aiProvider = 'openai';
    settings.ai = { openai: { apiKey: 'sk-cloud-key', model: 'gpt-4o' } };
    await saveSettings(settings);

    await setSyncPassphrase('cloud-pass-123');

    const syncData = await getEncryptedEnvelopeForSync();
    expect(syncData).not.toBeNull();
    expect(syncData!.envelope.salt).toBeTruthy(); // Has salt = PBKDF2 passphrase mode
    expect(syncData!.updatedAt).toBeGreaterThan(0);

    // Verify it's decryptable with the passphrase
    const json = await decrypt(syncData!.envelope, 'cloud-pass-123');
    const parsed = JSON.parse(json);
    expect(parsed.ai.openai.apiKey).toBe('sk-cloud-key');
  });

  it('importEncryptedEnvelope decrypts and re-encrypts with device key', async () => {
    const { importEncryptedEnvelope, loadSettings, setSyncPassphrase, invalidateCache } = await import('../src/shared/settings-service');
    const { encrypt } = await import('../src/shared/crypto-service');
    invalidateCache();

    // Simulate a cloud envelope (passphrase-encrypted)
    const cloudSettings = {
      version: 1,
      aiProvider: 'google',
      ai: { google: { apiKey: 'AIza-from-cloud', model: 'gemini-2.0-flash' } },
      imageProvider: 'none',
      image: {},
      cloud: { apiUrl: '' },
      updatedAt: Date.now(),
    };
    const cloudEnvelope = await encrypt(JSON.stringify(cloudSettings), 'import-pass');

    await setSyncPassphrase('import-pass');

    const success = await importEncryptedEnvelope(cloudEnvelope, cloudSettings.updatedAt);
    expect(success).toBe(true);

    // Load should return the imported settings (device-key encrypted now)
    invalidateCache();
    const loaded = await loadSettings();
    expect(loaded.aiProvider).toBe('google');
    expect(loaded.ai.google?.apiKey).toBe('AIza-from-cloud');
  });

  it('importEncryptedEnvelope fails with wrong passphrase', async () => {
    const { importEncryptedEnvelope, setSyncPassphrase, invalidateCache } = await import('../src/shared/settings-service');
    const { encrypt } = await import('../src/shared/crypto-service');
    invalidateCache();

    const cloudEnvelope = await encrypt('{"version":1}', 'correct-pass');
    await setSyncPassphrase('wrong-pass');

    const success = await importEncryptedEnvelope(cloudEnvelope, Date.now());
    expect(success).toBe(false);
  });

  it('importEncryptedEnvelope skips if local is newer', async () => {
    const { saveSettings, importEncryptedEnvelope, setSyncPassphrase, loadSettings, getDefaultSettings, invalidateCache } = await import('../src/shared/settings-service');
    const { encrypt } = await import('../src/shared/crypto-service');
    invalidateCache();

    // Save locally first (this will have a recent updatedAt)
    const local = getDefaultSettings();
    local.ai = { openai: { apiKey: 'sk-local', model: 'gpt-4o' } };
    await saveSettings(local);

    // Create an "older" cloud envelope
    const oldSettings = { ...getDefaultSettings(), ai: { openai: { apiKey: 'sk-old-cloud', model: 'gpt-4o' } }, updatedAt: 1000 };
    const cloudEnvelope = await encrypt(JSON.stringify(oldSettings), 'pass');
    await setSyncPassphrase('pass');

    const success = await importEncryptedEnvelope(cloudEnvelope, 1000);
    expect(success).toBe(true); // Returns true (no-op, not an error)

    // Local key should be preserved (not overwritten by older cloud data)
    invalidateCache();
    const loaded = await loadSettings();
    expect(loaded.ai.openai?.apiKey).toBe('sk-local');
  });

  it('config resolution helpers work', async () => {
    const { saveSettings, getDefaultSettings, getEffectiveAIConfig, getEffectiveImageConfig, getEffectiveCloudUrl, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.aiProvider = 'anthropic';
    settings.ai = { anthropic: { apiKey: 'sk-ant-config', model: 'claude-sonnet-4-20250514' } };
    settings.imageProvider = 'openai';
    settings.image = { openai: { apiKey: 'sk-img-key', model: 'dall-e-3' } };
    settings.cloud = { apiUrl: 'https://my-api.com' };
    await saveSettings(settings);

    invalidateCache();

    const aiConfig = await getEffectiveAIConfig();
    expect(aiConfig).not.toBeNull();
    expect(aiConfig!.provider).toBe('anthropic');
    expect(aiConfig!.apiKey).toBe('sk-ant-config');

    const imgConfig = await getEffectiveImageConfig();
    expect(imgConfig).not.toBeNull();
    expect(imgConfig!.provider).toBe('openai');

    const cloudUrl = await getEffectiveCloudUrl();
    expect(cloudUrl).toBe('https://my-api.com');
  });
});
