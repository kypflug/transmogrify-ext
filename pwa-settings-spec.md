# PWA Settings & Cloud Transmogrify Spec

> Implementation spec for adding **Settings UI**, **encrypted key sync**, and **Add URL** to the Library of Transmogrifia PWA ([kypflug/transmogrifia-pwa](https://github.com/kypflug/transmogrifia-pwa)).

## Goals

1. **Settings page** — Configure AI provider + API keys, image provider, and cloud function URL directly in the PWA
2. **Encrypted key sync** — Keys encrypted/decrypted with the same crypto as the extension; synced via OneDrive at `/drive/special/approot/settings.enc.json`
3. **Add URL** — New button in the Library to submit a URL for cloud transmogrification, so articles can be created without the browser extension

---

## 1. Shared Types & Crypto

The PWA must consume the **same** encrypted envelope formats and settings schema as the extension. Copy (or extract to a shared package) these types and functions:

### From `transmogrify-ext`

| Source file | What to copy | Notes |
|---|---|---|
| `src/shared/crypto-service.ts` | `encrypt()`, `decrypt()`, `encryptWithKey()`, `decryptWithKey()`, `EncryptedEnvelope`, `LocalEncryptedEnvelope` | Entire file — pure Web Crypto API, no Chrome dependencies |
| `src/shared/device-key.ts` | `getDeviceKey()`, `deleteDeviceKey()` | Entire file — pure IndexedDB + Web Crypto, no Chrome dependencies |
| `src/shared/types.ts` | `UserAIConfig` union type | Used in cloud queue request body |
| `src/shared/config.ts` | `AIProvider`, `ImageProvider`, `AIConfig` / `ImageConfig` discriminated unions | Type definitions only |
| `src/shared/settings-service.ts` | `TransmogrifierSettings`, `AIProviderSettings`, `ImageProviderSettings`, `CloudSettings` | Interfaces only — the service itself must be rewritten for PWA (no `chrome.storage`) |

### Two-Tier Encryption Model

| Tier | Purpose | Key source | Stored where |
|---|---|---|---|
| **Local** | Day-to-day settings access | Non-extractable `CryptoKey` in IndexedDB (`TransmogrifierKeyStore`) | Device-local, auto-generated, no user input |
| **Cloud sync** | Cross-device settings on OneDrive | User passphrase → PBKDF2 (600k iterations) | `settings.enc.json` in OneDrive AppFolder |

### Crypto Parameters (must match extension)

| Parameter | Local (device key) | Cloud (passphrase) |
|---|---|---|
| Algorithm | AES-256-GCM | AES-256-GCM |
| Key | Non-extractable `CryptoKey` | PBKDF2-SHA256, 600,000 iterations |
| Salt | N/A | 16 bytes, random, fresh per encrypt |
| IV | 12 bytes, random, fresh | 12 bytes, random, fresh |
| Envelope type | `LocalEncryptedEnvelope` | `EncryptedEnvelope` |

---

## 2. Settings Service (PWA version)

New file: `src/services/settings.ts`

Replaces `chrome.storage.local` + `chrome.storage.session` with web-standard equivalents:

| Concern | Extension | PWA |
|---|---|---|
| Device key | IndexedDB `TransmogrifierKeyStore` | IndexedDB `TransmogrifierKeyStore` (same code!) |
| Locally-encrypted envelope | `chrome.storage.local` | IndexedDB store `settings` (key: `envelope`) |
| Sync passphrase (memory-only) | `chrome.storage.session` | Module-scoped variable (`let syncPassphrase: string \| null`) — cleared on page unload / after idle timeout |
| Settings sync | `getEncryptedEnvelopeForSync()` / `importEncryptedEnvelope()` | Same logic, different storage backend |

### API surface

```typescript
// src/services/settings.ts

export function hasSyncPassphrase(): boolean;
export function setSyncPassphrase(p: string): void;
export function clearSyncPassphrase(): void;

export async function loadSettings(): Promise<TransmogrifierSettings>;
// Decrypts with device key from IndexedDB — no user input needed

export async function saveSettings(settings: TransmogrifierSettings): Promise<void>;
// Encrypts with device key, saves to IDB

export async function pushSettingsToCloud(): Promise<void>;
// Loads settings, re-encrypts with sync passphrase (PBKDF2), uploads to OneDrive

export async function pullSettingsFromCloud(): Promise<boolean>;
// Downloads settings.enc.json, decrypts with sync passphrase,
// re-encrypts with device key, stores in IDB. Returns true if updated.

export async function getEffectiveAIConfig(): Promise<AIConfig>;
export async function getEffectiveImageConfig(): Promise<ImageConfig>;
export async function getCloudUrl(): Promise<string | undefined>;
```

### IndexedDB changes

Bump `TransmogrifiaPWA` DB version from **1 → 2**. Add object store:

```typescript
// In src/services/cache.ts onupgradeneeded handler
if (!db.objectStoreNames.contains('settings')) {
  db.createObjectStore('settings'); // key-value store, key = 'envelope'
}
```

### OneDrive sync additions

Add to `src/services/graph.ts`:

```typescript
const SETTINGS_PATH = '/drive/special/approot/settings.enc.json';

export async function downloadSettings(): Promise<EncryptedEnvelope | null> {
  // GET {SETTINGS_PATH}:/content
  // Return parsed JSON or null on 404
}

export async function uploadSettings(envelope: EncryptedEnvelope): Promise<void> {
  // PUT {SETTINGS_PATH}:/content
  // Content-Type: application/json
}
```

This is the same file path the extension uses (`/drive/special/approot/settings.enc.json`), so settings encrypted by the extension are immediately available to the PWA and vice versa.

---

## 3. Settings Screen

New files:
- `src/screens/settings.ts`
- `src/styles/settings.css`

### Routing

Add a `settings` route to `main.ts`:

```typescript
// In boot() or a new router function
function route() {
  const hash = location.hash.slice(1);
  if (hash === 'settings') return renderSettings();
  if (isSignedIn()) return renderLibrary();
  return renderSignIn();
}
window.addEventListener('hashchange', route);
```

### Entry point

Add a **"Settings"** item to the user dropdown menu in `library.ts` (`setupUserMenu()`), between "Clear cache" and "Sign out":

```html
<button data-action="settings">⚙ Settings</button>
```

Clicking it sets `location.hash = '#settings'`.

### UI layout

Match the extension's `settings.html` visual design (card-based form on a centered column). Sections:

1. **Sync Passphrase** (for OneDrive cross-device sync)
   - Password input + "Set" / "Change" button
   - Status indicator: "🔒 Passphrase set" / "🔓 No passphrase"
   - Only needed if the user wants to sync settings across devices
   - Not required for local use — settings work immediately without it
   - "Forget passphrase" link (clears memory-only variable)

2. **AI Provider** — fieldset identical to extension
   - Provider select: Azure OpenAI | OpenAI | Anthropic | Google
   - Dynamic fields per provider (endpoint, key, deployment, model, API version)

3. **Image Provider** — fieldset identical to extension
   - Provider select: None | Azure OpenAI | OpenAI | Google
   - Dynamic fields per provider

4. **Cloud API** — single URL input for the Azure Function endpoint

5. **Actions row**
   - "Save" — encrypts + saves + pushes to OneDrive
   - "Pull from cloud" — downloads latest `settings.enc.json` and decrypts
   - "Back to Library" — navigates to `#library`

### First-launch flow

1. User signs in → PWA checks for `settings.enc.json` on OneDrive
2. If found → prompt for sync passphrase → decrypt → re-encrypt with device key → store locally → ready
3. If not found → user enters keys in Settings → encrypted with device key immediately → optionally set sync passphrase to push to cloud
4. Subsequent visits: settings loaded via device key — no passphrase prompt

---

## 4. Add URL Feature

### UI

Add a **"+ Add"** button to the Library toolbar (next to search/filter controls):

```html
<button class="add-url-btn" title="Add a URL to transmogrify">+ Add</button>
```

Clicking it opens a **modal dialog**:

```
┌─────────────────────────────────────────┐
│  Add URL                            ✕   │
│                                         │
│  URL: [https://example.com/article   ]  │
│                                         │
│  Recipe: [Focus Mode          ▾]        │
│                                         │
│  Custom prompt (optional):              │
│  [                                   ]  │
│                                         │
│         [Cancel]  [✨ Transmogrify]     │
└─────────────────────────────────────────┘
```

### Prerequisites check

Before showing the modal, verify:
1. User is signed in (needed for OneDrive access token and article delivery)
2. Cloud API URL is configured in settings
3. AI provider is configured in settings

If any are missing, show a toast directing the user to Settings.

### Request flow

```typescript
// src/services/cloud-queue.ts (new file)

interface QueueRequest {
  url: string;
  recipeId: string;
  accessToken: string;        // User's Graph token (for OneDrive write-back)
  aiConfig: UserAIConfig;     // User's AI credentials (BYOK)
  customPrompt?: string;
}

interface QueueResponse {
  jobId: string;
  message: string;
}

export async function queueTransmogrify(request: QueueRequest): Promise<QueueResponse> {
  const cloudUrl = await getCloudUrl();
  const response = await fetch(`${cloudUrl}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Queue failed: ${response.status}`);
  return response.json();
}
```

### After queueing

1. Close modal
2. Show toast: "Queued — article will appear after next sync"
3. (Optional) Trigger an immediate sync pull after a delay (e.g., 30 seconds) to pick up the result faster

### UserAIConfig construction

Build `UserAIConfig` from decrypted settings, same discriminated union as the extension's `getCloudAIConfig()`:

```typescript
function buildUserAIConfig(settings: TransmogrifierSettings): UserAIConfig {
  const ai = settings.ai;
  if (!ai) throw new Error('AI provider not configured');
  
  switch (ai.provider) {
    case 'azure-openai':
      return { provider: 'azure-openai', endpoint: ai.endpoint!, apiKey: ai.apiKey!, deployment: ai.deployment!, apiVersion: ai.apiVersion };
    case 'openai':
      return { provider: 'openai', apiKey: ai.apiKey!, model: ai.model };
    case 'anthropic':
      return { provider: 'anthropic', apiKey: ai.apiKey!, model: ai.model };
    case 'google':
      return { provider: 'google', apiKey: ai.apiKey!, model: ai.model };
  }
}
```

---

## 5. Implementation Plan

### Phase 1 — Crypto & Settings Service
1. Copy `crypto-service.ts` into PWA (verbatim — zero Chrome dependencies)
2. Copy `device-key.ts` into PWA (verbatim — pure IndexedDB + Web Crypto)
3. Copy shared type definitions (`TransmogrifierSettings`, `AIProviderSettings`, `ImageProviderSettings`, `CloudSettings`, `EncryptedEnvelope`, `LocalEncryptedEnvelope`, `UserAIConfig`)
4. Implement `src/services/settings.ts` (IDB-backed, device key for local, passphrase for sync)
5. Add `downloadSettings()` / `uploadSettings()` to `graph.ts`
6. Bump IDB version, add `settings` object store

### Phase 2 — Settings UI
6. Create `src/screens/settings.ts` + `src/styles/settings.css`
7. Add hash-based routing in `main.ts`
8. Add "Settings" to user dropdown menu
9. Wire save/load/pull/push to settings service
10. Handle first-launch flow (detect cloud envelope, prompt for passphrase)

### Phase 3 — Add URL
11. Create `src/services/cloud-queue.ts`
12. Add "+ Add" button to library toolbar
13. Create add-URL modal in `src/screens/library.ts`
14. Wire modal → prerequisites check → queue request → toast
15. Optional: auto-sync-pull after delay

### Phase 4 — Polish
16. Auto-pull settings on sign-in (alongside article sync)
17. Idle timeout for passphrase (clear after 30 min of inactivity)
18. "Test connection" button in Settings (validates AI key with a minimal API call)
19. CSP update in `staticwebapp.config.json` to allow `connect-src` to cloud function URL
20. Update PWA's README, CHANGELOG, version

---

## 6. Compatibility Contract

These must stay in sync between extension and PWA:

| Surface | Extension file | PWA file |
|---|---|---|
| `EncryptedEnvelope` | `src/shared/crypto-service.ts` | `src/services/crypto.ts` |
| `LocalEncryptedEnvelope` | `src/shared/crypto-service.ts` | `src/services/crypto.ts` |
| `device-key.ts` | `src/shared/device-key.ts` | `src/services/device-key.ts` |
| `TransmogrifierSettings` | `src/shared/settings-service.ts` | `src/types.ts` |
| `AIProviderSettings` / `ImageProviderSettings` | `src/shared/settings-service.ts` | `src/types.ts` |
| `UserAIConfig` | `src/shared/types.ts` | `src/types.ts` |
| PBKDF2 iterations (600,000) | `src/shared/crypto-service.ts` | `src/services/crypto.ts` |
| Settings sync path | `settings.enc.json` in `onedrive-service.ts` | `SETTINGS_PATH` in `graph.ts` |
| Queue request body shape | `src/shared/cloud-queue-service.ts` | `src/services/cloud-queue.ts` |
| `OneDriveArticleMeta` | `src/shared/onedrive-service.ts` | `src/types.ts` |
| OneDrive articles path | `articles/` in `onedrive-service.ts` | `APP_FOLDER` in `graph.ts` |

---

## 7. Security Considerations

- **Device key never leaves the device**: Non-extractable `CryptoKey` stored in IndexedDB — cannot be read, exported, or transmitted
- **No passphrase needed locally**: Settings encrypted/decrypted transparently with device key. Zero friction for day-to-day use.
- **Sync passphrase never persisted**: Held in a module-scoped variable, cleared on page unload and after idle timeout. Only needed when syncing to/from OneDrive.
- **Same cloud format as extension**: If a user sets up keys in the extension and sets a sync passphrase, they enter the same passphrase in the PWA to decrypt — no re-entry of API keys needed
- **BYOK for cloud queue**: The PWA sends the user's own AI keys in the request body, same as the extension. The cloud function has no server-side keys.
- **CSP**: Update `staticwebapp.config.json` `connect-src` to include the cloud function URL origin
- **No plaintext keys anywhere**: Local settings = device-key encrypted in IndexedDB; cloud settings = passphrase-encrypted on OneDrive; passphrase only in memory
