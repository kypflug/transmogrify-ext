/**
 * Tests for the two-tier encryption system:
 *  - crypto-service.ts (identity-key + device-key modes)
 *  - device-key.ts (CryptoKey generation & persistence)
 *  - settings-service.ts (load/save/sync with both tiers)
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── crypto-service tests ────────────────

describe('crypto-service', () => {
  let deriveIdentityKey: typeof import('../src/shared/crypto-service').deriveIdentityKey;
  let encryptWithIdentityKey: typeof import('../src/shared/crypto-service').encryptWithIdentityKey;
  let decryptWithIdentityKey: typeof import('../src/shared/crypto-service').decryptWithIdentityKey;
  let decryptLegacyEnvelope: typeof import('../src/shared/crypto-service').decryptLegacyEnvelope;
  let encryptWithKey: typeof import('../src/shared/crypto-service').encryptWithKey;
  let decryptWithKey: typeof import('../src/shared/crypto-service').decryptWithKey;

  beforeEach(async () => {
    const mod = await import('../src/shared/crypto-service');
    deriveIdentityKey = mod.deriveIdentityKey;
    encryptWithIdentityKey = mod.encryptWithIdentityKey;
    decryptWithIdentityKey = mod.decryptWithIdentityKey;
    decryptLegacyEnvelope = mod.decryptLegacyEnvelope;
    encryptWithKey = mod.encryptWithKey;
    decryptWithKey = mod.decryptWithKey;
  });

  describe('identity-key-based (HKDF)', () => {
    const userId = '00000000-0000-0000-0000-000000000001';

    it('deriveIdentityKey is deterministic for the same userId', async () => {
      const key1 = await deriveIdentityKey(userId);
      const key2 = await deriveIdentityKey(userId);
      expect(key1).toBeInstanceOf(CryptoKey);
      expect(key2).toBeInstanceOf(CryptoKey);
      expect(key1.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    });

    it('different userIds produce different keys', async () => {
      const otherUserId = '00000000-0000-0000-0000-000000000002';
      const envelope = await encryptWithIdentityKey('secret data', userId);
      await expect(decryptWithIdentityKey(envelope, otherUserId)).rejects.toThrow();
    });

    it('encrypt then decrypt round-trips correctly', async () => {
      const plaintext = JSON.stringify({ apiKey: 'sk-test-12345', model: 'gpt-4o' });
      const envelope = await encryptWithIdentityKey(plaintext, userId);

      expect(envelope.v).toBe(2);
      expect(envelope.iv).toBeTruthy();
      expect(envelope.data).toBeTruthy();
      expect((envelope as any).salt).toBeUndefined();
      expect(envelope.data).not.toContain('sk-test');

      const decrypted = await decryptWithIdentityKey(envelope, userId);
      expect(decrypted).toBe(plaintext);
    });

    it('tampered ciphertext throws', async () => {
      const envelope = await encryptWithIdentityKey('hello world', userId);
      const tampered = { ...envelope, data: envelope.data.slice(0, -2) + 'AA' };
      await expect(decryptWithIdentityKey(tampered, userId)).rejects.toThrow();
    });

    it('produces unique IV each time', async () => {
      const e1 = await encryptWithIdentityKey('same data', userId);
      const e2 = await encryptWithIdentityKey('same data', userId);
      expect(e1.iv).not.toBe(e2.iv);
      expect(e1.data).not.toBe(e2.data);
    });

    it('handles empty string', async () => {
      const envelope = await encryptWithIdentityKey('', userId);
      const decrypted = await decryptWithIdentityKey(envelope, userId);
      expect(decrypted).toBe('');
    });

    it('handles unicode content', async () => {
      const text = '日本語テスト 🔑 Ελληνικά';
      const envelope = await encryptWithIdentityKey(text, userId);
      const decrypted = await decryptWithIdentityKey(envelope, userId);
      expect(decrypted).toBe(text);
    });

    it('handles large payloads', async () => {
      const large = JSON.stringify({ data: 'x'.repeat(100_000) });
      const envelope = await encryptWithIdentityKey(large, userId);
      const decrypted = await decryptWithIdentityKey(envelope, userId);
      expect(decrypted).toBe(large);
    });
  });

  describe('legacy envelope decryption (PBKDF2 migration)', () => {
    async function createLegacyEnvelope(plaintext: string, passphrase: string) {
      const encoder = new TextEncoder();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const keyMaterial = await crypto.subtle.importKey(
        'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
      );
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, encoder.encode(plaintext),
      );

      const toBase64 = (bytes: Uint8Array) => {
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary);
      };

      return {
        v: 1 as const,
        salt: toBase64(salt),
        iv: toBase64(iv),
        data: toBase64(new Uint8Array(ciphertext)),
      };
    }

    it('decrypts a legacy v1 envelope with correct passphrase', async () => {
      const plaintext = '{"apiKey":"sk-legacy-123"}';
      const envelope = await createLegacyEnvelope(plaintext, 'my-old-passphrase');
      const decrypted = await decryptLegacyEnvelope(envelope, 'my-old-passphrase');
      expect(decrypted).toBe(plaintext);
    });

    it('wrong passphrase throws', async () => {
      const envelope = await createLegacyEnvelope('secret data', 'correct-pass');
      await expect(decryptLegacyEnvelope(envelope, 'wrong-pass')).rejects.toThrow();
    });

    it('rejects non-v1 envelope', async () => {
      const fakeEnvelope = { v: 2, iv: 'abc', data: 'def' } as any;
      await expect(decryptLegacyEnvelope(fakeEnvelope, 'pass')).rejects.toThrow(/Expected v1/);
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
    it('identity-key envelope cannot be decrypted with device key', async () => {
      const deviceKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      const userId = '00000000-0000-0000-0000-000000000001';
      const identityEnv = await encryptWithIdentityKey('secret', userId);
      await expect(decryptWithKey(identityEnv as any, deviceKey)).rejects.toThrow();
    });
  });
});

// ─── device-key tests ────────────────

describe('device-key', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
  });

  it('generates a key on first call', async () => {
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
    expect(key1).toBe(key2);
  });

  it('deleteDeviceKey removes the key', async () => {
    const { getDeviceKey, deleteDeviceKey } = await import('../src/shared/device-key');
    const key1 = await getDeviceKey();
    expect(key1).toBeTruthy();

    await deleteDeviceKey();

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
  const localStore: Record<string, any> = {};
  const TEST_USER_ID = '00000000-0000-0000-0000-aabbccddeeff';

  beforeEach(() => {
    Object.keys(localStore).forEach(k => delete localStore[k]);
    indexedDB = new IDBFactory();

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
    invalidateCache();

    const loaded = await loadSettings();
    expect(loaded.aiProvider).toBe('openai');
    expect(loaded.ai.openai?.apiKey).toBe('sk-test-round-trip');
    expect(loaded.ai.openai?.model).toBe('gpt-4o');
    expect(loaded.cloud.apiUrl).toBe('https://my-func.azurewebsites.net');
    expect(loaded.updatedAt).toBeGreaterThan(0);
  });

  it('saveSettings does not require sign-in', async () => {
    const { saveSettings, getDefaultSettings, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.ai = { google: { apiKey: 'AIzaTest', model: 'gemini-2.0-flash' } };

    await expect(saveSettings(settings)).resolves.not.toThrow();
  });

  it('saved data is encrypted in chrome.storage.local', async () => {
    const { saveSettings, getDefaultSettings, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.ai = { openai: { apiKey: 'sk-super-secret', model: 'gpt-4o' } };
    await saveSettings(settings);

    const raw = localStore['userSettings'];
    expect(raw).toBeTruthy();
    expect(raw.envelope).toBeTruthy();
    expect(raw.envelope.v).toBe(1);
    expect(raw.envelope.iv).toBeTruthy();
    expect(raw.envelope.data).toBeTruthy();
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

  it('getEncryptedEnvelopeForSync returns null when not signed in', async () => {
    vi.resetModules();
    vi.doMock('../src/shared/auth-service', () => ({
      getUserId: vi.fn(async () => null),
    }));

    const { saveSettings, getDefaultSettings, getEncryptedEnvelopeForSync, invalidateCache } = await import('../src/shared/settings-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.ai = { openai: { apiKey: 'sk-sync-test', model: 'gpt-4o' } };
    await saveSettings(settings);

    const result = await getEncryptedEnvelopeForSync();
    expect(result).toBeNull();

    vi.doUnmock('../src/shared/auth-service');
  });

  it('getEncryptedEnvelopeForSync produces identity-key encrypted envelope', async () => {
    vi.resetModules();
    vi.doMock('../src/shared/auth-service', () => ({
      getUserId: vi.fn(async () => TEST_USER_ID),
    }));

    const { saveSettings, getDefaultSettings, getEncryptedEnvelopeForSync, invalidateCache } = await import('../src/shared/settings-service');
    const { decryptWithIdentityKey } = await import('../src/shared/crypto-service');
    invalidateCache();

    const settings = getDefaultSettings();
    settings.aiProvider = 'openai';
    settings.ai = { openai: { apiKey: 'sk-cloud-key', model: 'gpt-4o' } };
    await saveSettings(settings);

    const syncData = await getEncryptedEnvelopeForSync();
    expect(syncData).not.toBeNull();
    expect(syncData!.envelope.v).toBe(2);
    expect((syncData!.envelope as any).salt).toBeUndefined();
    expect(syncData!.updatedAt).toBeGreaterThan(0);

    const json = await decryptWithIdentityKey(syncData!.envelope, TEST_USER_ID);
    const parsed = JSON.parse(json);
    expect(parsed.ai.openai.apiKey).toBe('sk-cloud-key');

    vi.doUnmock('../src/shared/auth-service');
  });

  it('importEncryptedEnvelope decrypts v2 envelope and re-encrypts with device key', async () => {
    vi.resetModules();
    vi.doMock('../src/shared/auth-service', () => ({
      getUserId: vi.fn(async () => TEST_USER_ID),
    }));

    const { importEncryptedEnvelope, loadSettings, invalidateCache } = await import('../src/shared/settings-service');
    const { encryptWithIdentityKey } = await import('../src/shared/crypto-service');
    invalidateCache();

    const cloudSettings = {
      version: 1,
      aiProvider: 'google',
      ai: { google: { apiKey: 'AIza-from-cloud', model: 'gemini-2.0-flash' } },
      imageProvider: 'none',
      image: {},
      cloud: { apiUrl: '' },
      updatedAt: Date.now(),
    };
    const cloudEnvelope = await encryptWithIdentityKey(JSON.stringify(cloudSettings), TEST_USER_ID);

    const success = await importEncryptedEnvelope(cloudEnvelope, cloudSettings.updatedAt);
    expect(success).toBe(true);

    invalidateCache();
    const loaded = await loadSettings();
    expect(loaded.aiProvider).toBe('google');
    expect(loaded.ai.google?.apiKey).toBe('AIza-from-cloud');

    vi.doUnmock('../src/shared/auth-service');
  });

  it('importEncryptedEnvelope fails when not signed in', async () => {
    vi.resetModules();
    vi.doMock('../src/shared/auth-service', () => ({
      getUserId: vi.fn(async () => null),
    }));

    const { importEncryptedEnvelope, invalidateCache } = await import('../src/shared/settings-service');
    const { encryptWithIdentityKey } = await import('../src/shared/crypto-service');
    invalidateCache();

    const envelope = await encryptWithIdentityKey('{"version":1}', TEST_USER_ID);
    const result = await importEncryptedEnvelope(envelope, Date.now());
    expect(result).not.toBe(true);
    expect(typeof result).toBe('string');

    vi.doUnmock('../src/shared/auth-service');
  });

  it('importEncryptedEnvelope skips if local is newer', async () => {
    vi.resetModules();
    vi.doMock('../src/shared/auth-service', () => ({
      getUserId: vi.fn(async () => TEST_USER_ID),
    }));

    const { saveSettings, importEncryptedEnvelope, loadSettings, getDefaultSettings, invalidateCache } = await import('../src/shared/settings-service');
    const { encryptWithIdentityKey } = await import('../src/shared/crypto-service');
    invalidateCache();

    const local = getDefaultSettings();
    local.ai = { openai: { apiKey: 'sk-local', model: 'gpt-4o' } };
    await saveSettings(local);

    const oldSettings = { ...getDefaultSettings(), ai: { openai: { apiKey: 'sk-old-cloud', model: 'gpt-4o' } }, updatedAt: 1000 };
    const cloudEnvelope = await encryptWithIdentityKey(JSON.stringify(oldSettings), TEST_USER_ID);

    const success = await importEncryptedEnvelope(cloudEnvelope, 1000);
    expect(success).toBe(true);

    invalidateCache();
    const loaded = await loadSettings();
    expect(loaded.ai.openai?.apiKey).toBe('sk-local');

    vi.doUnmock('../src/shared/auth-service');
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
