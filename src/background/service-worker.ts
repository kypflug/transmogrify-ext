/**
 * Transmogrifier - Service Worker (Background Script)
 * Handles AI analysis, image generation, and saves transmogrified pages to IndexedDB
 * Supports parallel transmogrify operations with independent progress tracking
 */

import { RemixMessage, RemixResponse, GeneratedImageData, RemixRequest } from '../shared/types';
import { loadPreferences, savePreferences } from '../shared/utils';
import { analyzeWithAI } from '../shared/ai-service';
import { getRecipe, BUILT_IN_RECIPES, sanitizeOutputHtml } from '@kypflug/transmogrifier-core';
import type { ImagePlaceholder } from '@kypflug/transmogrifier-core';
import { generateImages, base64ToDataUrl, ImageGenerationRequest } from '../shared/image-service';
import { isImageConfiguredAsync } from '../shared/config';
import { 
  saveArticle, 
  getArticle, 
  getAllArticles, 
  deleteArticle, 
  toggleFavorite, 
  exportArticleToFile,
  getStorageStats,
  migrateFixUnicodeEscapes
} from '../shared/storage-service';
import { signIn, signOut, isSignedIn, getUserInfo } from '../shared/auth-service';
import {
  pushArticleToCloud,
  prepareDeleteForSync,
  pushDeleteToCloud,
  pushMetaUpdateToCloud,
  pullFromCloud,
  downloadCloudArticle,
  toggleCloudFavorite,
  getSyncState,
  setupSyncAlarm,
} from '../shared/sync-service';
import { uploadSettings, downloadSettings } from '../shared/onedrive-service';
import { getEncryptedEnvelopeForSync, importEncryptedEnvelope, invalidateCache as invalidateSettingsCache, tryAutoImportSettingsFromCloud } from '../shared/settings-service';
import { shareArticle, unshareArticle } from '../shared/blob-storage-service';

// In-memory storage for AbortControllers (per request)
const abortControllers = new Map<string, AbortController>();

/**
 * Broadcast to any open extension pages (library, viewer) that articles changed.
 * Failures are expected when no listeners are open.
 */
function broadcastArticlesChanged(reason: string) {
  chrome.runtime.sendMessage({ type: 'ARTICLES_CHANGED', reason }).catch(() => {});
}

// In-memory storage for elapsed time intervals
const elapsedIntervals = new Map<string, ReturnType<typeof setInterval>>();

// Time thresholds for remix warnings
const WARNING_THRESHOLD_MS = 2 * 60 * 1000;  // Show warning after 2 minutes
const LONG_WARNING_THRESHOLD_MS = 5 * 60 * 1000;  // Stronger warning after 5 minutes

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get all active remixes from storage
 */
async function getActiveRemixes(): Promise<Record<string, RemixRequest>> {
  const { activeRemixes } = await chrome.storage.local.get('activeRemixes');
  return activeRemixes || {};
}

/**
 * Update a specific remix request in storage
 */
async function updateRemixProgress(requestId: string, updates: Partial<RemixRequest>) {
  const remixes = await getActiveRemixes();
  
  if (remixes[requestId]) {
    remixes[requestId] = { ...remixes[requestId], ...updates };
  } else {
    // New request - updates should contain all required fields
    remixes[requestId] = updates as RemixRequest;
  }
  
  await chrome.storage.local.set({ activeRemixes: remixes });
  
  // Update badge
  await updateBadge(remixes);
  
  // Send message to popup (if open)
  chrome.runtime.sendMessage({ 
    type: 'PROGRESS_UPDATE', 
    requestId,
    progress: remixes[requestId]
  }).catch(() => {
    // Popup might be closed, that's okay
  });
}

/**
 * Remove a remix request from storage (cleanup)
 */
async function removeRemixRequest(requestId: string) {
  const remixes = await getActiveRemixes();
  delete remixes[requestId];
  await chrome.storage.local.set({ activeRemixes: remixes });
  await updateBadge(remixes);
  
  // Cleanup interval and controller
  const interval = elapsedIntervals.get(requestId);
  if (interval) {
    clearInterval(interval);
    elapsedIntervals.delete(requestId);
  }
  abortControllers.delete(requestId);
}

/**
 * Update badge based on active remixes
 */
async function updateBadge(remixes: Record<string, RemixRequest>) {
  const activeList = Object.values(remixes);
  const inProgress = activeList.filter(r => 
    !['complete', 'error', 'idle'].includes(r.status)
  );
  const hasError = activeList.some(r => r.status === 'error');
  
  if (inProgress.length === 0) {
    // Check if any recently completed
    const recentComplete = activeList.some(r => r.status === 'complete');
    if (recentComplete) {
      await chrome.action.setBadgeText({ text: 'OK' });
      await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    } else if (hasError) {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } else if (inProgress.length === 1) {
    // Single active - show short status label (badge only supports ~4 ASCII chars)
    const statusLabel: Record<string, string> = {
      'extracting': '...',
      'analyzing': 'AI',
      'generating-images': 'IMG',
      'saving': 'SAVE',
      'cloud-queued': '☁️',
    };
    await chrome.action.setBadgeText({ text: statusLabel[inProgress[0].status] || '...' });
    await chrome.action.setBadgeBackgroundColor({ color: '#9C27B0' });
  } else {
    // Multiple active - show count
    await chrome.action.setBadgeText({ text: String(inProgress.length) });
    await chrome.action.setBadgeBackgroundColor({ color: '#9C27B0' });
  }
}

/**
 * Cleanup truly orphaned remixes (no in-memory controller means the service worker
 * was suspended and the fetch was lost). Also adds warning flags to long-running remixes.
 * This is called on startup and can be triggered manually.
 */
async function cleanupStaleRemixes(): Promise<{ cleaned: number; remaining: number }> {
  const now = Date.now();
  const remixes = await getActiveRemixes();
  const cleaned: string[] = [];
  const remaining: Record<string, RemixRequest> = {};
  let changed = false;
  
  for (const [id, remix] of Object.entries(remixes)) {
    // Already completed or errored - schedule cleanup
    if (['complete', 'error'].includes(remix.status)) {
      scheduleCleanup(id, 1000);
      remaining[id] = remix;
      continue;
    }
    
    const elapsed = now - remix.startTime;
    const hasController = abortControllers.has(id);
    
    if (!hasController) {
      // No controller means the service worker restarted and the fetch is gone.
      // This is a truly orphaned request - mark as error.
      console.log(`[Transmogrifier] Cleaning orphaned remix ${id} (${Math.round(elapsed / 1000)}s old, no controller)`);
      remix.status = 'error';
      remix.error = `Request lost when browser suspended the extension (after ${Math.round(elapsed / 1000)}s). Please try again.`;
      cleaned.push(id);
      remaining[id] = remix;
      scheduleCleanup(id, 5000);
      changed = true;
    } else {
      // Controller exists - request is still running. Add warnings if long.
      if (elapsed > LONG_WARNING_THRESHOLD_MS) {
        remix.warning = `Running for ${Math.round(elapsed / 1000)}s — this is unusually long but may still complete`;
        changed = true;
      } else if (elapsed > WARNING_THRESHOLD_MS) {
        remix.warning = `Taking longer than usual (${Math.round(elapsed / 1000)}s)`;
        changed = true;
      }
      remaining[id] = remix;
    }
  }
  
  if (changed) {
    await chrome.storage.local.set({ activeRemixes: remaining });
    await updateBadge(remaining);
  }
  if (cleaned.length > 0) {
    console.log(`[Transmogrifier] Cleaned ${cleaned.length} orphaned remixes`);
  }
  
  return { cleaned: cleaned.length, remaining: Object.keys(remaining).length };
}

// Run cleanup on service worker startup (every time it wakes up)
cleanupStaleRemixes().catch(console.error);

// On every alarm tick (e.g. the 5-min sync alarm), run stale-job cleanup.
// This is critical because setTimeout-based cleanup is lost when the
// service worker is suspended by the browser.
chrome.alarms.onAlarm.addListener(() => {
  cleanupStaleRemixes().catch(console.error);
});

/**
 * Restore viewer/library tabs that were invalidated by an extension reload.
 * Finds tabs showing the "Extension context invalidated" error page and
 * re-opens them at the correct extension URL.
 */
async function restoreViewerTabs() {
  try {
    // Look for tabs that were our viewer or library pages (now dead)
    const tabs = await chrome.tabs.query({});
    const extensionOrigin = chrome.runtime.getURL('');
    
    for (const tab of tabs) {
      if (!tab.url || !tab.id) continue;
      
      // Match our old extension URLs that are now invalidated
      // After reload, the extension ID stays the same, so URLs still match
      if (tab.url.startsWith(extensionOrigin)) {
        // Extract the path portion to recreate the URL
        const path = tab.url.substring(extensionOrigin.length);
        if (path.startsWith('src/viewer/viewer.html') || path.startsWith('src/library/library.html')) {
          const newUrl = chrome.runtime.getURL(path);
          console.log(`[Transmogrifier] Restoring tab: ${path}`);
          await chrome.tabs.update(tab.id, { url: newUrl });
        }
      }
    }
  } catch (error) {
    console.error('[Transmogrifier] Failed to restore tabs:', error);
  }
}

// Listen for extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[Transmogrifier] Extension installed');
    loadPreferences();
  }
  // Clear any stale remixes on install/update
  chrome.storage.local.set({ activeRemixes: {} });
  chrome.action.setBadgeText({ text: '' });

  // Set up periodic sync alarm
  setupSyncAlarm();

  // One-time data migrations
  migrateFixUnicodeEscapes().catch(err =>
    console.error('[Transmogrifier] Unicode-escape migration failed:', err)
  );

  // Restore viewer tabs that were killed by extension reload/update
  if (details.reason === 'update') {
    await restoreViewerTabs();
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener(
  (message: RemixMessage, _sender, sendResponse: (response: RemixResponse) => void) => {
    handleMessage(message).then(sendResponse);
    return true; // Keep channel open for async response
  }
);

async function handleMessage(message: RemixMessage): Promise<RemixResponse> {
  switch (message.type) {
    case 'AI_ANALYZE': {
      // Fire-and-forget: kick off the remix in the background so the popup can close immediately
      performRemix(message).catch(err => console.error('[Transmogrifier] Remix failed:', err));
      return { success: true };
    }

    case 'GET_ACTIVE_REMIXES': {
      const remixes = await getActiveRemixes();
      return { success: true, activeRemixes: Object.values(remixes) };
    }

    case 'CANCEL_REMIX': {
      const requestId = message.payload?.requestId;
      if (!requestId) {
        return { success: false, error: 'No request ID provided' };
      }
      
      // Abort the request
      const controller = abortControllers.get(requestId);
      if (controller) {
        controller.abort();
        console.log('[Transmogrifier] Cancelled request:', requestId);
      }
      
      // Update status and cleanup
      await updateRemixProgress(requestId, { status: 'error', error: 'Cancelled by user' });
      setTimeout(() => removeRemixRequest(requestId), 3000);
      
      return { success: true };
    }

    case 'DISMISS_REMIX': {
      const requestId = message.payload?.requestId;
      if (!requestId) {
        return { success: false, error: 'No request ID provided' };
      }
      await removeRemixRequest(requestId);
      return { success: true };
    }

    case 'GET_PROGRESS': {
      // Legacy support - return first active remix or idle
      const remixes = await getActiveRemixes();
      const active = Object.values(remixes)[0];
      if (active) {
        return { 
          success: true, 
          progress: {
            status: active.status,
            step: active.step,
            error: active.error,
            startTime: active.startTime,
            pageTitle: active.pageTitle,
            recipeId: active.recipeId,
            articleId: active.articleId,
          }
        };
      }
      return { success: true, progress: { status: 'idle', step: '' } };
    }

    case 'RESET_PROGRESS': {
      // Clear all completed/errored remixes
      const remixes = await getActiveRemixes();
      const toKeep: Record<string, RemixRequest> = {};
      for (const [id, remix] of Object.entries(remixes)) {
        if (!['complete', 'error', 'idle'].includes(remix.status)) {
          toKeep[id] = remix;
        }
      }
      await chrome.storage.local.set({ activeRemixes: toKeep });
      await updateBadge(toKeep);
      return { success: true };
    }

    case 'CLEAR_STALE_REMIXES': {
      // Force-cancel all running remixes (with or without controllers)
      const remixes = await getActiveRemixes();
      let forceCleaned = 0;
      for (const [id, remix] of Object.entries(remixes)) {
        if (!['complete', 'error', 'idle'].includes(remix.status)) {
          // Abort if controller exists
          const ctrl = abortControllers.get(id);
          if (ctrl) {
            ctrl.abort();
          }
          remix.status = 'error';
          remix.error = 'Manually cancelled';
          remix.warning = undefined;
          remixes[id] = remix;
          forceCleaned++;
          scheduleCleanup(id, 3000);
        }
      }
      if (forceCleaned > 0) {
        await chrome.storage.local.set({ activeRemixes: remixes });
        await updateBadge(remixes);
      }
      return { success: true, cleaned: forceCleaned };
    }

    case 'GET_ARTICLES': {
      try {
        const articles = await getAllArticles();
        return { success: true, articles };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'GET_ARTICLE': {
      try {
        const article = await getArticle(message.payload?.articleId || '');
        return { success: true, article: article || undefined };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'DELETE_ARTICLE': {
      try {
        const delId = message.payload?.articleId || '';
        await deleteArticle(delId);
        // Await local sync cleanup (cloud index + pending-delete) before broadcasting,
        // so getMergedArticleList won't re-surface the article as cloud-only.
        await prepareDeleteForSync(delId);
        broadcastArticlesChanged('delete');
        // Fire-and-forget the slow remote OneDrive delete
        pushDeleteToCloud(delId).catch(() => {});
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'TOGGLE_FAVORITE': {
      try {
        const favId = message.payload?.articleId || '';
        let isFavorite: boolean;
        try {
          isFavorite = await toggleFavorite(favId);
          // Push meta update to cloud in background
          getArticle(favId).then(a => { if (a) pushMetaUpdateToCloud(a).catch(() => {}); });
        } catch {
          // Article not found locally — try cloud-only toggle
          isFavorite = await toggleCloudFavorite(favId);
        }
        return { success: true, isFavorite };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'EXPORT_ARTICLE': {
      try {
        await exportArticleToFile(message.payload?.articleId || '');
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'GET_STORAGE_STATS': {
      try {
        const stats = await getStorageStats();
        return { success: true, stats };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'OPEN_ARTICLE': {
      try {
        const articleId = message.payload?.articleId;
        if (!articleId) {
          return { success: false, error: 'No article ID provided' };
        }
        // Open the viewer page with the article ID
        const viewerUrl = chrome.runtime.getURL(`src/viewer/viewer.html?id=${articleId}`);
        await chrome.tabs.create({ url: viewerUrl, active: true });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'RESPIN_ARTICLE': {
      return await performRespin(message);
    }

    case 'GET_STATUS': {
      return { success: true };
    }

    case 'UPDATE_SETTINGS': {
      if (message.payload?.settings) {
        await savePreferences(message.payload.settings);
        return { success: true };
      }
      return { success: false, error: 'No settings provided' };
    }

    // ─── Sync Messages ─────────────────────────────

    case 'SYNC_SIGN_IN': {
      try {
        await signIn();
        // Do an initial pull after sign-in
        pullFromCloud().catch(err => console.error('[Sync] Initial pull failed:', err));
        // On a new device with no settings, silently pull from OneDrive
        tryAutoImportSettingsFromCloud(downloadSettings).catch(err =>
          console.warn('[Sync] Auto-import settings failed:', err)
        );
        const userInfo = await getUserInfo();
        const syncState = await getSyncState();
        return {
          success: true,
          syncStatus: {
            signedIn: true,
            userName: userInfo?.name,
            userEmail: userInfo?.email,
            lastSyncTime: syncState.lastSyncTime,
            isSyncing: syncState.isSyncing,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'SYNC_SIGN_OUT': {
      try {
        await signOut();
        return {
          success: true,
          syncStatus: {
            signedIn: false,
            lastSyncTime: 0,
            isSyncing: false,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'SYNC_STATUS': {
      try {
        const signedIn = await isSignedIn();
        const userInfo = signedIn ? await getUserInfo() : null;
        const syncState = await getSyncState();
        return {
          success: true,
          syncStatus: {
            signedIn,
            userName: userInfo?.name,
            userEmail: userInfo?.email,
            lastSyncTime: syncState.lastSyncTime,
            isSyncing: syncState.isSyncing,
            lastError: syncState.lastError,
          },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'SYNC_NOW': {
      try {
        const result = await pullFromCloud();
        const syncState = await getSyncState();
        const userInfo = await getUserInfo();

        // Always broadcast so any open library/viewer pages refresh their article list.
        // The caller also refreshes, but the broadcast ensures the UI updates
        // even if cross-context storage propagation has a brief delay.
        broadcastArticlesChanged('sync-now');

        return {
          success: true,
          syncStatus: {
            signedIn: true,
            userName: userInfo?.name,
            userEmail: userInfo?.email,
            lastSyncTime: syncState.lastSyncTime,
            isSyncing: false,
            lastError: syncState.lastError,
          },
          stats: { count: result.pulled, totalSize: result.deleted },
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'SYNC_DOWNLOAD_ARTICLE': {
      try {
        const articleId = message.payload?.articleId;
        if (!articleId) return { success: false, error: 'No article ID' };
        const article = await downloadCloudArticle(articleId);
        return { success: true, article: article || undefined };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    // ─── Settings Sync Messages ─────────────────

    case 'SETTINGS_PUSH': {
      try {
        const envelope = await getEncryptedEnvelopeForSync();
        if (!envelope) {
          return { success: false, error: 'No settings to push. Configure settings first.' };
        }
        const json = JSON.stringify(envelope);
        await uploadSettings(json);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'SETTINGS_PULL': {
      try {
        const json = await downloadSettings();
        if (!json) {
          return { success: false, error: 'No settings found in OneDrive' };
        }
        const data = JSON.parse(json);

        // Determine envelope: expect { envelope: {...}, updatedAt } wrapper,
        // but also handle bare envelope (v/iv/data at top level) for robustness.
        let envelope = data.envelope;
        let updatedAt = data.updatedAt;
        if (!envelope && typeof data.v === 'number') {
          // File is a bare SyncEncryptedEnvelope (no wrapper)
          console.log('[Settings] Pull: bare envelope detected (no wrapper)');
          envelope = data;
          updatedAt = data.updatedAt ?? 0;
        }
        if (!envelope || typeof envelope.v !== 'number') {
          console.error('[Settings] Pull: unexpected data structure, keys:', Object.keys(data));
          return { success: false, error: 'Cloud settings file has an unexpected format. Try re-pushing your settings.' };
        }

        const imported = await importEncryptedEnvelope(envelope, updatedAt);
        if (imported !== true) {
          // imported is a descriptive error string
          return { success: false, error: imported };
        }
        invalidateSettingsCache();
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'SHARE_ARTICLE': {
      try {
        const articleId = message.payload?.articleId;
        if (!articleId) return { success: false, error: 'Missing articleId' };

        const article = await getArticle(articleId);
        if (!article) return { success: false, error: 'Article not found' };

        const result = await shareArticle(
          article.id,
          article.html,
          article.title,
          message.payload?.expiresAt,
          article.images,
        );

        return {
          success: true,
          shareResult: result,
        };
      } catch (error) {
        console.error('[SW] Share failed:', error);
        return { success: false, error: String(error) };
      }
    }

    case 'UNSHARE_ARTICLE': {
      try {
        const articleId = message.payload?.articleId;
        if (!articleId) return { success: false, error: 'Missing articleId' };

        const article = await getArticle(articleId);
        if (!article) return { success: false, error: 'Article not found' };

        await unshareArticle(article.id, article.shareShortCode || '');
        return { success: true };
      } catch (error) {
        console.error('[SW] Unshare failed:', error);
        return { success: false, error: String(error) };
      }
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * Main remix operation - supports parallel execution
 */
async function performRemix(message: RemixMessage): Promise<RemixResponse> {
  const requestId = generateRequestId();
  console.log('[Transmogrifier] AI_ANALYZE started, request:', requestId);
  
  // Get the recipe
  const recipeId = message.payload?.recipeId || 'reader';
  const recipe = getRecipe(recipeId);
  const generateImagesFlag = message.payload?.generateImages ?? false;
  
  console.log('[Transmogrifier] Recipe:', recipeId, 'Generate images:', generateImagesFlag);
  
  if (!recipe) {
    return { success: false, error: `Unknown recipe: ${recipeId}` };
  }

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { success: false, error: 'No active tab' };
  }

  const pageTitle = tab.title || 'Transmogrified Page';
  const tabId = tab.id;
  
  // Initialize progress
  await updateRemixProgress(requestId, { 
    requestId,
    tabId,
    status: 'extracting', 
    step: 'Extracting page content...',
    startTime: Date.now(),
    pageTitle,
    recipeId,
  });

  // Request content extraction from content script
  let content: string;
  try {
    console.log('[Transmogrifier] Requesting content extraction...');
    let extractResponse;
    try {
      extractResponse = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTENT' });
    } catch {
      // Content script likely not injected (e.g. after extension reload).
      // Re-inject and retry.
      console.log('[Transmogrifier] Content script not reachable, re-injecting...');
      const manifest = chrome.runtime.getManifest();
      const contentScriptJs = manifest.content_scripts?.[0]?.js ?? [];
      const contentScriptCss = manifest.content_scripts?.[0]?.css ?? [];
      if (contentScriptJs.length > 0) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: contentScriptJs,
        });
      }
      if (contentScriptCss.length > 0) {
        await chrome.scripting.insertCSS({
          target: { tabId },
          files: contentScriptCss,
        });
      }
      extractResponse = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTENT' });
    }
    if (!extractResponse?.success || !extractResponse.content) {
      const error = extractResponse?.error || 'Failed to extract content';
      await updateRemixProgress(requestId, { status: 'error', error });
      return { success: false, error, requestId };
    }
    content = extractResponse.content;
    console.log('[Transmogrifier] Content extracted, length:', content.length);
  } catch (error) {
    const errorMsg = `Content script error: ${error}`;
    await updateRemixProgress(requestId, { status: 'error', error: errorMsg });
    return { success: false, error: errorMsg, requestId };
  }

  // Create AbortController for this request
  const controller = new AbortController();
  abortControllers.set(requestId, controller);

  // Call AI service to generate HTML with elapsed time updates
  const aiStartTime = Date.now();
  await updateRemixProgress(requestId, { status: 'analyzing', step: 'AI is generating HTML... (0s)' });
  
  // Update elapsed time every 5 seconds during AI call, add warnings for long runs
  const elapsedInterval = setInterval(async () => {
    const elapsed = Date.now() - aiStartTime;
    const elapsedSec = Math.round(elapsed / 1000);
    const updates: Partial<RemixRequest> = { step: `AI is generating HTML... (${elapsedSec}s)` };
    
    if (elapsed > LONG_WARNING_THRESHOLD_MS) {
      updates.warning = `Running for ${elapsedSec}s \u2014 this is unusually long but may still complete`;
    } else if (elapsed > WARNING_THRESHOLD_MS) {
      updates.warning = `Taking longer than usual (${elapsedSec}s)`;
    }
    
    await updateRemixProgress(requestId, updates);
  }, 5000);
  elapsedIntervals.set(requestId, elapsedInterval);
  const isImageHeavyRecipe = generateImagesFlag || recipeId === 'illustrated';
  const maxTokens = isImageHeavyRecipe ? 48000 : 32768;
  
  console.log('[Transmogrifier] Calling Azure OpenAI (max tokens:', maxTokens, ')...');
  const aiResult = await analyzeWithAI({
    recipe,
    domContent: content,
    customPrompt: message.payload?.customPrompt,
    includeImages: generateImagesFlag,
    maxTokens,
    abortSignal: controller.signal,
  });
  
  clearInterval(elapsedInterval);
  elapsedIntervals.delete(requestId);
  
  const aiDuration = Math.round((Date.now() - aiStartTime) / 1000);
  console.log('[Transmogrifier] AI response received in', aiDuration, 'seconds:', aiResult.success ? 'success' : 'failed', aiResult.error || '');

  if (!aiResult.success || !aiResult.data) {
    const error = aiResult.error || 'AI analysis failed';
    await updateRemixProgress(requestId, { status: 'error', error: `${error} (after ${aiDuration}s)` });
    return { success: false, error, requestId };
  }

  let finalHtml = sanitizeOutputHtml(aiResult.data.html);

  // Generate images if requested and AI returned image placeholders
  if (generateImagesFlag && aiResult.data.images && aiResult.data.images.length > 0) {
    if (!await isImageConfiguredAsync()) {
      console.warn('[Transmogrifier] Image generation requested but not configured');
    } else {
      await updateRemixProgress(requestId, { 
        status: 'generating-images', 
        step: `Generating ${aiResult.data.images.length} images...` 
      });
      
      console.log('[Transmogrifier] Generating', aiResult.data.images.length, 'images...');
      try {
        const generatedImages = await generateImagesFromPlaceholders(aiResult.data.images);
        console.log('[Transmogrifier] Images generated:', generatedImages.length);
        
        // Replace image placeholders in HTML with actual data URLs
        finalHtml = replaceImagePlaceholders(finalHtml, generatedImages);
      } catch (imgError) {
        console.error('[Transmogrifier] Image generation failed:', imgError);
        // Continue without images
      }
    }
  }

  // Save to IndexedDB and open viewer
  await updateRemixProgress(requestId, { status: 'saving', step: 'Saving transmogrified page...' });
  
  try {
    console.log('[Transmogrifier] Saving to IndexedDB, HTML length:', finalHtml.length);
    
    // Get recipe name for display
    const recipeName = BUILT_IN_RECIPES.find(r => r.id === recipeId)?.name || recipeId;
    
    // Save to IndexedDB (include original content for respins)
    const savedArticle = await saveArticle({
      title: pageTitle,
      originalUrl: tab.url || '',
      recipeId,
      recipeName,
      html: finalHtml,
      originalContent: content,
    });
    
    console.log('[Transmogrifier] Article saved:', savedArticle.id);
    
    // Push to cloud in background (non-blocking)
    pushArticleToCloud(savedArticle).catch(() => {});
    
    // Notify open library/viewer pages
    broadcastArticlesChanged('remix');
    
    await updateRemixProgress(requestId, { 
      status: 'complete', 
      step: 'Done!',
      articleId: savedArticle.id,
    });
    
    // Cleanup success after short delay
    scheduleCleanup(requestId, 5000);
    
    return { 
      success: true, 
      aiExplanation: aiResult.data.explanation,
      articleId: savedArticle.id,
      requestId,
    };
  } catch (error) {
    const errorMsg = `Failed to save article: ${error}`;
    await updateRemixProgress(requestId, { status: 'error', error: errorMsg });
    return { success: false, error: errorMsg, requestId };
  }
}

/**
 * Schedule cleanup of a remix request after a delay
 */
function scheduleCleanup(requestId: string, delayMs = 10000) {
  setTimeout(() => removeRemixRequest(requestId), delayMs);
}

/**
 * Respin an existing article with a new recipe
 */
async function performRespin(message: RemixMessage): Promise<RemixResponse> {
  const requestId = generateRequestId();
  const articleId = message.payload?.articleId;
  const recipeId = message.payload?.recipeId || 'reader';
  const generateImagesFlag = message.payload?.generateImages ?? false;
  
  if (!articleId) {
    return { success: false, error: 'No article ID provided' };
  }
  
  // Get the original article
  const originalArticle = await getArticle(articleId);
  if (!originalArticle) {
    return { success: false, error: 'Article not found' };
  }
  
  // Check if we have original content to respin
  if (!originalArticle.originalContent) {
    return { success: false, error: 'This article cannot be respun (no original content stored). Try remixing the original page again.' };
  }
  
  const recipe = getRecipe(recipeId);
  if (!recipe) {
    return { success: false, error: `Unknown recipe: ${recipeId}` };
  }
  
  console.log('[Transmogrifier] Respinning article:', articleId, 'with recipe:', recipeId, 'request:', requestId);
  
  // Create AbortController for this request
  const controller = new AbortController();
  abortControllers.set(requestId, controller);
  
  // Update progress with elapsed time
  const aiStartTime = Date.now();
  await updateRemixProgress(requestId, { 
    requestId,
    tabId: 0, // No source tab for respin
    status: 'analyzing', 
    step: 'AI is generating new design... (0s)',
    startTime: aiStartTime,
    pageTitle: originalArticle.title,
    recipeId,
  });
  
  // Update elapsed time every 5 seconds, add warnings for long runs
  const elapsedInterval = setInterval(async () => {
    const elapsed = Date.now() - aiStartTime;
    const elapsedSec = Math.round(elapsed / 1000);
    const updates: Partial<RemixRequest> = { step: `AI is generating new design... (${elapsedSec}s)` };
    
    if (elapsed > LONG_WARNING_THRESHOLD_MS) {
      updates.warning = `Running for ${elapsedSec}s \u2014 this is unusually long but may still complete`;
    } else if (elapsed > WARNING_THRESHOLD_MS) {
      updates.warning = `Taking longer than usual (${elapsedSec}s)`;
    }
    
    await updateRemixProgress(requestId, updates);
  }, 5000);
  elapsedIntervals.set(requestId, elapsedInterval);
  
  // Determine token limits based on recipe complexity
  const isImageHeavyRecipe = generateImagesFlag || recipeId === 'illustrated';
  const maxTokens = isImageHeavyRecipe ? 48000 : 32768;
  
  // Call AI service
  const aiResult = await analyzeWithAI({
    recipe,
    domContent: originalArticle.originalContent,
    customPrompt: message.payload?.customPrompt,
    includeImages: generateImagesFlag,
    maxTokens,
    abortSignal: controller.signal,
  });
  
  clearInterval(elapsedInterval);
  elapsedIntervals.delete(requestId);
  
  const aiDuration = Math.round((Date.now() - aiStartTime) / 1000);
  
  if (!aiResult.success || !aiResult.data) {
    const error = aiResult.error || 'AI analysis failed';
    await updateRemixProgress(requestId, { status: 'error', error: `${error} (after ${aiDuration}s)` });
    return { success: false, error, requestId };
  }
  
  let finalHtml = sanitizeOutputHtml(aiResult.data.html);
  
  // Generate images if requested
  if (generateImagesFlag && aiResult.data.images && aiResult.data.images.length > 0 && await isImageConfiguredAsync()) {
    await updateRemixProgress(requestId, { 
      status: 'generating-images', 
      step: `Generating ${aiResult.data.images.length} images...` 
    });
    
    try {
      const generatedImages = await generateImagesFromPlaceholders(aiResult.data.images);
      finalHtml = replaceImagePlaceholders(finalHtml, generatedImages);
    } catch (imgError) {
      console.error('[Transmogrifier] Image generation failed:', imgError);
    }
  }
  
  // Save as new article
  await updateRemixProgress(requestId, { status: 'saving', step: 'Saving new version...' });
  
  const recipeName = BUILT_IN_RECIPES.find(r => r.id === recipeId)?.name || recipeId;
  
  const newArticle = await saveArticle({
    title: originalArticle.title,
    originalUrl: originalArticle.originalUrl,
    recipeId,
    recipeName,
    html: finalHtml,
    originalContent: originalArticle.originalContent,
  });

  // Push to cloud in background
  pushArticleToCloud(newArticle).catch(() => {});
  
  // Notify open library/viewer pages
  broadcastArticlesChanged('respin');
  
  await updateRemixProgress(requestId, { 
    status: 'complete', 
    step: 'Done!',
    articleId: newArticle.id,
  });
  
  scheduleCleanup(requestId, 5000);
  
  return { 
    success: true, 
    aiExplanation: aiResult.data.explanation,
    articleId: newArticle.id,
    requestId,
  };
}

/**
 * Generate images from AI-provided placeholders
 */
async function generateImagesFromPlaceholders(placeholders: ImagePlaceholder[]): Promise<GeneratedImageData[]> {
  if (!placeholders || placeholders.length === 0) {
    return [];
  }

  console.log(`[Transmogrifier] Generating ${placeholders.length} images...`);

  // Build image generation requests
  const requests: ImageGenerationRequest[] = placeholders.map((placeholder) => ({
    prompt: placeholder.prompt,
    size: placeholder.size || '1024x1024',
    style: placeholder.style || 'natural',
  }));

  // Generate all images
  const result = await generateImages(requests);

  // Map results back to GeneratedImageData format
  const generatedImages: GeneratedImageData[] = [];
  
  for (let i = 0; i < placeholders.length; i++) {
    const placeholder = placeholders[i];
    const generated = result.images[i];

    if (generated && !generated.error) {
      // Always produce an inline data URL so the HTML is self-contained.
      // Some providers (Azure DALL-E) return only a temporary URL that
      // expires after ~60 min — embedding as base64 avoids that.
      let dataUrl: string;
      if (generated.base64) {
        dataUrl = base64ToDataUrl(generated.base64);
      } else if (generated.url) {
        try {
          const imgResp = await fetch(generated.url);
          if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
          const buf = await imgResp.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
          const contentType = imgResp.headers.get('content-type') || 'image/png';
          dataUrl = `data:${contentType};base64,${btoa(binary)}`;
        } catch (fetchErr) {
          console.warn(`[Transmogrifier] Failed to inline image URL for ${placeholder.id}:`, fetchErr);
          dataUrl = generated.url; // last-resort fallback
        }
      } else {
        console.warn(`[Transmogrifier] No image data for ${placeholder.id}`);
        continue;
      }
      
      generatedImages.push({
        id: placeholder.id,
        dataUrl,
        altText: placeholder.altText,
      });
      console.log(`[Transmogrifier] Generated image: ${placeholder.id}`);
    } else {
      console.warn(`[Transmogrifier] Failed to generate image ${placeholder.id}:`, generated?.error);
    }
  }

  return generatedImages;
}

/**
 * Replace {{image-id}} placeholders in HTML with actual data URLs
 */
function replaceImagePlaceholders(html: string, images: GeneratedImageData[]): string {
  let result = html;
  
  for (const image of images) {
    // Replace {{image-id}} placeholder patterns
    const placeholder = `{{${image.id}}}`;
    result = result.replaceAll(placeholder, image.dataUrl);
  }
  
  return result;
}


