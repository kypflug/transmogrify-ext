/**
 * Transmogrifier — Settings Page Script
 * Manages the settings UI for AI providers, image providers, cloud config,
 * encryption passphrase, and OneDrive settings sync.
 */

import type { AIProvider, ImageProvider } from '../shared/config';
import {
  loadSettings,
  saveSettings,
  getDefaultSettings,
  hasSyncPassphrase,
  setSyncPassphrase,
  clearSettings,
  invalidateCache,
  type TransmogrifierSettings,
  type SharingProvider,
} from '../shared/settings-service';
import { isSignedIn } from '../shared/auth-service';

// ─── DOM References ────────────────

const backBtn = document.getElementById('backBtn')!;
const saveIndicator = document.getElementById('saveIndicator')!;

// Passphrase
const passphraseInput = document.getElementById('passphrase') as HTMLInputElement;
const passphraseConfirm = document.getElementById('passphraseConfirm') as HTMLInputElement;
const setPassphraseBtn = document.getElementById('setPassphraseBtn')!;
const passphraseBadge = document.getElementById('passphraseBadge')!;
const passphraseError = document.getElementById('passphraseError')!;
const togglePassphraseVisibility = document.getElementById('togglePassphraseVisibility')!;

// AI Provider
const aiProviderSelect = document.getElementById('aiProvider') as HTMLSelectElement;
const aiBadge = document.getElementById('aiBadge')!;
const aiFieldGroups: Record<string, HTMLElement> = {
  'azure-openai': document.getElementById('aiAzureFields')!,
  'openai': document.getElementById('aiOpenaiFields')!,
  'anthropic': document.getElementById('aiAnthropicFields')!,
  'google': document.getElementById('aiGoogleFields')!,
};

// Image Provider
const imageProviderSelect = document.getElementById('imageProvider') as HTMLSelectElement;
const imageBadge = document.getElementById('imageBadge')!;
const imgFieldGroups: Record<string, HTMLElement> = {
  'azure-openai': document.getElementById('imgAzureFields')!,
  'openai': document.getElementById('imgOpenaiFields')!,
  'google': document.getElementById('imgGoogleFields')!,
};

// Sharing Provider
const sharingProviderSelect = document.getElementById('sharingProvider') as HTMLSelectElement;
const sharingBadge = document.getElementById('sharingBadge')!;
const sharingFieldGroups: Record<string, HTMLElement> = {
  'azure-blob': document.getElementById('sharingAzureBlobFields')!,
};

// Sync
const pushSettingsBtn = document.getElementById('pushSettingsBtn')!;
const pullSettingsBtn = document.getElementById('pullSettingsBtn')!;
const syncBadge = document.getElementById('syncBadge')!;
const syncStatus = document.getElementById('syncStatus')!;

// Danger
const clearSettingsBtn = document.getElementById('clearSettingsBtn')!;

// ─── State ────────────────

let currentSettings: TransmogrifierSettings = getDefaultSettings();
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let syncPassphraseReady = false;

// ─── Initialization ────────────────

async function init() {
  // Check sync passphrase status
  syncPassphraseReady = await hasSyncPassphrase();
  updatePassphraseBadge();

  // Load settings (device-key encrypted — always works, no passphrase needed)
  currentSettings = await loadSettings();
  populateForm(currentSettings);

  // Set up event listeners
  setupEventListeners();

  // Update badges
  updateBadges();

  // Update sync status
  await updateSyncStatus();
}

// ─── Form Population ────────────────

function populateForm(settings: TransmogrifierSettings) {
  // AI Provider
  aiProviderSelect.value = settings.aiProvider;
  showProviderFields(aiFieldGroups, settings.aiProvider);

  // Azure OpenAI AI
  const azureAI = settings.ai.azureOpenai;
  if (azureAI) {
    (document.getElementById('aiAzureEndpoint') as HTMLInputElement).value = azureAI.endpoint || '';
    (document.getElementById('aiAzureKey') as HTMLInputElement).value = azureAI.apiKey || '';
    (document.getElementById('aiAzureDeployment') as HTMLInputElement).value = azureAI.deployment || '';
    (document.getElementById('aiAzureVersion') as HTMLInputElement).value = azureAI.apiVersion || '';
  }

  // OpenAI AI
  const openaiAI = settings.ai.openai;
  if (openaiAI) {
    (document.getElementById('aiOpenaiKey') as HTMLInputElement).value = openaiAI.apiKey || '';
    (document.getElementById('aiOpenaiModel') as HTMLInputElement).value = openaiAI.model || '';
  }

  // Anthropic AI
  const anthropicAI = settings.ai.anthropic;
  if (anthropicAI) {
    (document.getElementById('aiAnthropicKey') as HTMLInputElement).value = anthropicAI.apiKey || '';
    (document.getElementById('aiAnthropicModel') as HTMLInputElement).value = anthropicAI.model || '';
  }

  // Google AI
  const googleAI = settings.ai.google;
  if (googleAI) {
    (document.getElementById('aiGoogleKey') as HTMLInputElement).value = googleAI.apiKey || '';
    (document.getElementById('aiGoogleModel') as HTMLInputElement).value = googleAI.model || '';
  }

  // Image Provider
  imageProviderSelect.value = settings.imageProvider;
  showProviderFields(imgFieldGroups, settings.imageProvider);

  // Azure OpenAI Image
  const azureImg = settings.image.azureOpenai;
  if (azureImg) {
    (document.getElementById('imgAzureEndpoint') as HTMLInputElement).value = azureImg.endpoint || '';
    (document.getElementById('imgAzureKey') as HTMLInputElement).value = azureImg.apiKey || '';
    (document.getElementById('imgAzureDeployment') as HTMLInputElement).value = azureImg.deployment || '';
    (document.getElementById('imgAzureVersion') as HTMLInputElement).value = azureImg.apiVersion || '';
  }

  // OpenAI Image
  const openaiImg = settings.image.openai;
  if (openaiImg) {
    (document.getElementById('imgOpenaiKey') as HTMLInputElement).value = openaiImg.apiKey || '';
    (document.getElementById('imgOpenaiModel') as HTMLInputElement).value = openaiImg.model || '';
  }

  // Google Image
  const googleImg = settings.image.google;
  if (googleImg) {
    (document.getElementById('imgGoogleKey') as HTMLInputElement).value = googleImg.apiKey || '';
    (document.getElementById('imgGoogleModel') as HTMLInputElement).value = googleImg.model || '';
  }

  // Sharing Provider
  sharingProviderSelect.value = settings.sharingProvider || 'none';
  showProviderFields(sharingFieldGroups, settings.sharingProvider || 'none');

  // Azure Blob sharing
  const azureBlob = settings.sharing?.azureBlob;
  if (azureBlob) {
    (document.getElementById('sharingAccountName') as HTMLInputElement).value = azureBlob.accountName || '';
    (document.getElementById('sharingContainerName') as HTMLInputElement).value = azureBlob.containerName || '';
    (document.getElementById('sharingSasToken') as HTMLInputElement).value = azureBlob.sasToken || '';
  }
}

// ─── Form Reading ────────────────

function readFormToSettings(): TransmogrifierSettings {
  const settings = { ...currentSettings };

  // AI Provider
  settings.aiProvider = aiProviderSelect.value as AIProvider;

  // Initialize provider sub-objects
  if (!settings.ai) settings.ai = {};

  // Read all AI provider fields
  settings.ai.azureOpenai = {
    endpoint: val('aiAzureEndpoint'),
    apiKey: val('aiAzureKey'),
    deployment: val('aiAzureDeployment') || 'gpt-4o',
    apiVersion: val('aiAzureVersion') || '2024-10-21',
  };

  settings.ai.openai = {
    apiKey: val('aiOpenaiKey'),
    model: val('aiOpenaiModel') || 'gpt-4o',
  };

  settings.ai.anthropic = {
    apiKey: val('aiAnthropicKey'),
    model: val('aiAnthropicModel') || 'claude-sonnet-4-20250514',
  };

  settings.ai.google = {
    apiKey: val('aiGoogleKey'),
    model: val('aiGoogleModel') || 'gemini-2.0-flash',
  };

  // Image Provider
  settings.imageProvider = imageProviderSelect.value as ImageProvider;
  if (!settings.image) settings.image = {};

  settings.image.azureOpenai = {
    endpoint: val('imgAzureEndpoint'),
    apiKey: val('imgAzureKey'),
    deployment: val('imgAzureDeployment') || 'gpt-image-1',
    apiVersion: val('imgAzureVersion') || '2024-10-21',
  };

  settings.image.openai = {
    apiKey: val('imgOpenaiKey'),
    model: val('imgOpenaiModel') || 'gpt-image-1',
  };

  settings.image.google = {
    apiKey: val('imgGoogleKey'),
    model: val('imgGoogleModel') || 'gemini-2.5-flash-image',
  };

  // Cloud — uses hardcoded default, no user input needed
  settings.cloud = {
    apiUrl: '',
  };

  // Sharing Provider
  settings.sharingProvider = sharingProviderSelect.value as SharingProvider;
  if (!settings.sharing) settings.sharing = {};

  settings.sharing.azureBlob = {
    accountName: val('sharingAccountName'),
    containerName: val('sharingContainerName'),
    sasToken: val('sharingSasToken'),
  };

  return settings;
}

function val(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value.trim();
}

// ─── Auto-Save ────────────────

function scheduleAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      currentSettings = readFormToSettings();
      await saveSettings(currentSettings);
      flashSaveIndicator();
      updateBadges();
    } catch (err) {
      console.error('[Settings] Auto-save failed:', err);
    }
  }, 800);
}

function flashSaveIndicator() {
  saveIndicator.classList.remove('hidden');
  setTimeout(() => saveIndicator.classList.add('hidden'), 2000);
}

// ─── Event Listeners ────────────────

function setupEventListeners() {
  // Back button
  backBtn.addEventListener('click', () => {
    const url = chrome.runtime.getURL('src/library/library.html');
    window.location.href = url;
  });

  // Passphrase
  setPassphraseBtn.addEventListener('click', handleSetPassphrase);
  togglePassphraseVisibility.addEventListener('click', () => {
    const type = passphraseInput.type === 'password' ? 'text' : 'password';
    passphraseInput.type = type;
    passphraseConfirm.type = type;
  });

  // AI Provider switching
  aiProviderSelect.addEventListener('change', () => {
    showProviderFields(aiFieldGroups, aiProviderSelect.value);
    scheduleAutoSave();
  });

  // Image Provider switching
  imageProviderSelect.addEventListener('change', () => {
    showProviderFields(imgFieldGroups, imageProviderSelect.value);
    scheduleAutoSave();
  });

  // Sharing Provider switching
  sharingProviderSelect.addEventListener('change', () => {
    showProviderFields(sharingFieldGroups, sharingProviderSelect.value);
    scheduleAutoSave();
  });

  // Auto-save on any input change
  const allInputs = document.querySelectorAll('input[type="text"], input[type="password"], input[type="url"]');
  allInputs.forEach(input => {
    input.addEventListener('input', () => scheduleAutoSave());
  });

  // Checkboxes — currently none, auto-save is on inputs only

  // Sync buttons
  pushSettingsBtn.addEventListener('click', handlePushSettings);
  pullSettingsBtn.addEventListener('click', handlePullSettings);

  // Clear all
  clearSettingsBtn.addEventListener('click', handleClearSettings);
}

// ─── Handler: Set Passphrase ────────────────

async function handleSetPassphrase() {
  const pp = passphraseInput.value;
  const confirm = passphraseConfirm.value;

  if (!pp) {
    showPassphraseError('Please enter a passphrase');
    return;
  }

  if (pp.length < 8) {
    showPassphraseError('Passphrase must be at least 8 characters');
    return;
  }

  if (pp !== confirm) {
    showPassphraseError('Passphrases do not match');
    return;
  }

  try {
    await setSyncPassphrase(pp);
    syncPassphraseReady = true;
    updatePassphraseBadge();
    hidePassphraseError();

    // Clear passphrase fields
    passphraseInput.value = '';
    passphraseConfirm.value = '';

    updateBadges();
    await updateSyncStatus();
  } catch (err) {
    showPassphraseError(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }
}

function showPassphraseError(msg: string) {
  passphraseError.textContent = msg;
  passphraseError.classList.remove('hidden');
}

function hidePassphraseError() {
  passphraseError.classList.add('hidden');
}

// ─── Handler: Sync ────────────────

async function handlePushSettings() {
  if (!syncPassphraseReady) {
    syncStatus.textContent = '⚠️ Set a sync passphrase first';
    return;
  }

  const signedIn = await isSignedIn();
  if (!signedIn) {
    syncStatus.textContent = '⚠️ Sign in to OneDrive first (from Library)';
    return;
  }

  pushSettingsBtn.setAttribute('disabled', '');
  syncStatus.textContent = 'Pushing settings to OneDrive…';

  try {
    // Send message to service worker to handle the upload
    const response = await chrome.runtime.sendMessage({
      type: 'SETTINGS_PUSH',
    });

    if (response?.success) {
      syncStatus.textContent = '✅ Settings pushed to OneDrive';
      syncBadge.textContent = 'Synced';
      syncBadge.classList.add('configured');
    } else {
      syncStatus.textContent = `❌ ${response?.error || 'Push failed'}`;
    }
  } catch (err) {
    syncStatus.textContent = `❌ ${err instanceof Error ? err.message : 'Push failed'}`;
  } finally {
    pushSettingsBtn.removeAttribute('disabled');
  }
}

async function handlePullSettings() {
  if (!syncPassphraseReady) {
    syncStatus.textContent = '⚠️ Set a sync passphrase first to decrypt cloud settings';
    return;
  }

  const signedIn = await isSignedIn();
  if (!signedIn) {
    syncStatus.textContent = '⚠️ Sign in to OneDrive first (from Library)';
    return;
  }

  pullSettingsBtn.setAttribute('disabled', '');
  syncStatus.textContent = 'Pulling settings from OneDrive…';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SETTINGS_PULL',
    });

    if (response?.success) {
      // Reload settings and repopulate form
      invalidateCache();
      currentSettings = await loadSettings();
      populateForm(currentSettings);
      updateBadges();
      syncStatus.textContent = '✅ Settings pulled from OneDrive';
      syncBadge.textContent = 'Synced';
      syncBadge.classList.add('configured');
    } else {
      syncStatus.textContent = `❌ ${response?.error || 'Pull failed'}`;
    }
  } catch (err) {
    syncStatus.textContent = `❌ ${err instanceof Error ? err.message : 'Pull failed'}`;
  } finally {
    pullSettingsBtn.removeAttribute('disabled');
  }
}

// ─── Handler: Clear Settings ────────────────

async function handleClearSettings() {
  if (!confirm('Clear all settings, including API keys and device key? This cannot be undone.')) {
    return;
  }

  await clearSettings();
  syncPassphraseReady = false;
  currentSettings = getDefaultSettings();
  populateForm(currentSettings);
  updatePassphraseBadge();
  updateBadges();
}

// ─── UI Helpers ────────────────

function showProviderFields(groups: Record<string, HTMLElement>, activeProvider: string) {
  for (const [provider, el] of Object.entries(groups)) {
    el.classList.toggle('hidden', provider !== activeProvider);
  }
}

function updatePassphraseBadge() {
  if (syncPassphraseReady) {
    passphraseBadge.textContent = 'Set ✓';
    passphraseBadge.classList.add('configured');
    passphraseBadge.classList.remove('warning');
    setPassphraseBtn.textContent = 'Change Passphrase';
  } else {
    passphraseBadge.textContent = 'Not set';
    passphraseBadge.classList.remove('configured');
    passphraseBadge.classList.add('warning');
    setPassphraseBtn.textContent = 'Set Passphrase';
  }
}

function updateBadges() {
  // AI badge
  const aiProvider = currentSettings.aiProvider;
  const aiKey = getActiveAIKey(currentSettings);
  if (aiKey) {
    aiBadge.textContent = getProviderLabel(aiProvider);
    aiBadge.classList.add('configured');
  } else {
    aiBadge.textContent = 'Not configured';
    aiBadge.classList.remove('configured');
  }

  // Image badge
  const imgProvider = currentSettings.imageProvider;
  if (imgProvider === 'none') {
    imageBadge.textContent = 'Disabled';
    imageBadge.classList.remove('configured');
  } else {
    const imgKey = getActiveImageKey(currentSettings);
    if (imgKey) {
      imageBadge.textContent = getProviderLabel(imgProvider);
      imageBadge.classList.add('configured');
    } else {
      imageBadge.textContent = 'Not configured';
      imageBadge.classList.remove('configured');
    }
  }

  // Sharing badge
  const sharingProvider = currentSettings.sharingProvider;
  if (sharingProvider === 'none' || !sharingProvider) {
    sharingBadge.textContent = 'Disabled';
    sharingBadge.classList.remove('configured');
  } else {
    const sharingKey = currentSettings.sharing?.azureBlob?.sasToken || '';
    if (sharingKey) {
      sharingBadge.textContent = 'Azure Blob';
      sharingBadge.classList.add('configured');
    } else {
      sharingBadge.textContent = 'Not configured';
      sharingBadge.classList.remove('configured');
    }
  }

  // Cloud badge — always configured (hardcoded default)
}

async function updateSyncStatus() {
  const signedIn = await isSignedIn();
  if (!signedIn) {
    syncBadge.textContent = 'Not signed in';
    syncBadge.classList.remove('configured');
    pushSettingsBtn.setAttribute('disabled', '');
    pullSettingsBtn.setAttribute('disabled', '');
    syncStatus.textContent = 'Sign in to OneDrive from the Library to enable sync.';
  } else if (!syncPassphraseReady) {
    syncBadge.textContent = 'No passphrase';
    syncBadge.classList.remove('configured');
    syncStatus.textContent = 'Set a sync passphrase above to enable encrypted cloud sync.';
  } else {
    syncBadge.textContent = 'Ready';
    syncBadge.classList.add('configured');
    pushSettingsBtn.removeAttribute('disabled');
    pullSettingsBtn.removeAttribute('disabled');
    syncStatus.textContent = '';
  }
}

function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'azure-openai': return 'Azure OpenAI';
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic';
    case 'google': return 'Google';
    case 'none': return 'None';
    default: return provider;
  }
}

function getActiveAIKey(settings: TransmogrifierSettings): string {
  switch (settings.aiProvider) {
    case 'azure-openai': return settings.ai.azureOpenai?.apiKey || '';
    case 'openai': return settings.ai.openai?.apiKey || '';
    case 'anthropic': return settings.ai.anthropic?.apiKey || '';
    case 'google': return settings.ai.google?.apiKey || '';
  }
}

function getActiveImageKey(settings: TransmogrifierSettings): string {
  switch (settings.imageProvider) {
    case 'azure-openai': return settings.image.azureOpenai?.apiKey || '';
    case 'openai': return settings.image.openai?.apiKey || '';
    case 'google': return settings.image.google?.apiKey || '';
    case 'none': return '';
  }
}

// ─── Start ────────────────

init();
