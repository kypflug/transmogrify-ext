/**
 * Transmogrifier - Popup Script
 * Handles the extension popup UI for AI-powered transmogrification
 * Supports parallel transmogrify operations
 */

import { RemixMessage, RemixRequest } from '../shared/types';
import { BUILT_IN_RECIPES } from '../shared/recipes';
import { isAIConfigured, isImageConfigured } from '../shared/config';

// State
let selectedRecipeId = 'focus';
let pinnedRecipeIds: string[] = [];

// DOM Elements
const openLibraryBtn = document.getElementById('openLibraryBtn')!;

// Open library button
openLibraryBtn.addEventListener('click', () => {
  const url = chrome.runtime.getURL('src/library/library.html');
  chrome.tabs.create({ url });
  window.close();
});

// DOM Elements - Active Remixes
const activeRemixesSection = document.getElementById('activeRemixesSection')!;
const activeRemixesList = document.getElementById('activeRemixesList')!;
const activeCountEl = document.getElementById('activeCount')!;
const clearStuckLink = document.getElementById('clearStuck')!;

// DOM Elements - Remix
const elements = {
  statusIndicator: document.getElementById('statusIndicator')!,
  recipeList: document.getElementById('recipeList')!,
  customPromptSection: document.getElementById('customPromptSection')!,
  customPrompt: document.getElementById('customPrompt') as HTMLTextAreaElement,
  explanationSection: document.getElementById('explanationSection')!,
  explanationText: document.getElementById('explanationText')!,
  remixReadBtn: document.getElementById('remixReadBtn')!,
  remixSendBtn: document.getElementById('remixSendBtn')!,
  generateImages: document.getElementById('generateImages') as HTMLInputElement,
  imageToggleSection: document.querySelector('.image-toggle-section') as HTMLElement,
};

/**
 * Initialize popup
 */
async function init() {
  // Check if AI is configured
  if (!isAIConfigured()) {
    elements.statusIndicator.textContent = 'API Key Missing';
    elements.statusIndicator.classList.add('error');
  }

  // Check if image generation is available
  if (!isImageConfigured()) {
    elements.imageToggleSection.style.display = 'none';
  }

  // Load pinned recipes from storage
  await loadPinnedRecipes();

  // Render recipe buttons
  renderRecipes();
  
  // Set up event listeners
  setupEventListeners();
  
  // Load active remixes
  await loadActiveRemixes();
  
  // Start polling for updates
  startPolling();
}

/**
 * Load and display active remixes
 */
async function loadActiveRemixes() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_REMIXES' });
    if (!response?.success) return;
    
    const remixes: RemixRequest[] = response.activeRemixes || [];
    
    // Filter out idle remixes
    const activeRemixes = remixes.filter(r => r.status !== 'idle');
    
    if (activeRemixes.length === 0) {
      activeRemixesSection.style.display = 'none';
      return;
    }
    
    activeRemixesSection.style.display = 'block';
    activeCountEl.textContent = String(activeRemixes.length);
    
    activeRemixesList.innerHTML = activeRemixes.map((remix) => {
      const statusIcon = getStatusIcon(remix.status);
      const elapsed = Math.round((Date.now() - remix.startTime) / 1000);
      const elapsedStr = elapsed > 0 ? ` (${elapsed}s)` : '';
      const statusClass = remix.status === 'complete' ? 'complete' : remix.status === 'error' ? 'error' : '';
      const showCancel = !['complete', 'error'].includes(remix.status);
      const hasWarning = remix.warning && !['complete', 'error'].includes(remix.status);
      
      return `
        <div class="active-remix-item ${statusClass} ${hasWarning ? 'warning' : ''}" data-request-id="${remix.requestId}">
          <div class="active-remix-icon">${statusIcon}</div>
          <div class="active-remix-info">
            <div class="active-remix-title">${escapeHtml(remix.pageTitle)}</div>
            <div class="active-remix-status">${remix.step}${elapsedStr}</div>
            ${hasWarning ? `<div class="active-remix-warning">⚠ ${escapeHtml(remix.warning!)}</div>` : ''}
          </div>
          ${showCancel ? `<button class="active-remix-cancel" data-action="cancel" title="Cancel">✕</button>` : ''}
        </div>
      `;
    }).join('');
    
  } catch (e) {
    console.error('[Popup] Error loading active remixes:', e);
  }
}

/**
 * Get status icon for a remix status
 */
function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    'extracting': '📄',
    'analyzing': '🤖',
    'generating-images': '🎨',
    'saving': '💾',
    'complete': '✓',
    'error': '✗',
  };
  return icons[status] || '⏳';
}

/**
 * Start polling for active remix updates
 */
function startPolling() {
  // Poll every 2 seconds for updates
  setInterval(async () => {
    await loadActiveRemixes();
  }, 2000);
}

/**
 * Handle cancel button click
 */
async function cancelRemix(requestId: string) {
  try {
    await chrome.runtime.sendMessage({ 
      type: 'CANCEL_REMIX', 
      payload: { requestId } 
    });
    await loadActiveRemixes();
  } catch (e) {
    console.error('[Popup] Failed to cancel remix:', e);
  }
}

/**
 * Clear all stuck/stale remixes
 */
async function clearStuckRemixes() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_STALE_REMIXES' });
    console.log('[Popup] Cleared stuck remixes:', response);
    await loadActiveRemixes();
  } catch (e) {
    console.error('[Popup] Failed to clear stuck remixes:', e);
  }
}

/**
 * Load pinned recipe IDs from chrome.storage.sync
 */
async function loadPinnedRecipes() {
  try {
    const result = await chrome.storage.sync.get('pinnedRecipes');
    pinnedRecipeIds = result.pinnedRecipes || [];
  } catch (e) {
    console.log('[Popup] Failed to load pinned recipes');
    pinnedRecipeIds = [];
  }
}

/**
 * Save pinned recipe IDs to chrome.storage.sync
 */
async function savePinnedRecipes() {
  try {
    await chrome.storage.sync.set({ pinnedRecipes: pinnedRecipeIds });
  } catch (e) {
    console.error('[Popup] Failed to save pinned recipes:', e);
  }
}

/**
 * Toggle pin state for a recipe
 */
async function togglePin(recipeId: string) {
  const idx = pinnedRecipeIds.indexOf(recipeId);
  if (idx >= 0) {
    pinnedRecipeIds.splice(idx, 1);
  } else {
    pinnedRecipeIds.push(recipeId);
  }
  await savePinnedRecipes();
  renderRecipes();
}

/**
 * Render recipe selection tiles, pinned recipes first
 */
function renderRecipes() {
  const pinned = BUILT_IN_RECIPES.filter(r => pinnedRecipeIds.includes(r.id));
  const unpinned = BUILT_IN_RECIPES.filter(r => !pinnedRecipeIds.includes(r.id));
  
  // Sort pinned in the order they were pinned
  pinned.sort((a, b) => pinnedRecipeIds.indexOf(a.id) - pinnedRecipeIds.indexOf(b.id));
  
  let html = '';
  
  // Render pinned tiles
  for (const recipe of pinned) {
    html += renderRecipeTile(recipe, true);
  }
  
  // Add divider if there are pinned recipes
  if (pinned.length > 0 && unpinned.length > 0) {
    html += '<div class="recipe-pin-divider"></div>';
  }
  
  // Render unpinned tiles
  for (const recipe of unpinned) {
    html += renderRecipeTile(recipe, false);
  }
  
  elements.recipeList.innerHTML = html;
  
  // Scroll selected recipe into view if needed
  const activeTile = elements.recipeList.querySelector('.recipe-tile.active');
  if (activeTile) {
    activeTile.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Render a single recipe tile
 */
function renderRecipeTile(recipe: typeof BUILT_IN_RECIPES[0], isPinned: boolean): string {
  const isActive = recipe.id === selectedRecipeId;
  const pinIcon = isPinned ? '📌' : '📍';
  const pinTitle = isPinned ? 'Unpin recipe' : 'Pin to top';
  
  return `
    <div class="recipe-tile ${isActive ? 'active' : ''}" data-recipe="${recipe.id}">
      <div class="recipe-tile-icon">${recipe.icon}</div>
      <div class="recipe-tile-body">
        <div class="recipe-tile-header">
          <span class="recipe-tile-name">${recipe.name}</span>
        </div>
        <div class="recipe-tile-summary">${recipe.summary}</div>
      </div>
      <button class="recipe-pin-btn ${isPinned ? 'pinned' : ''}" 
              data-pin="${recipe.id}" title="${pinTitle}">${pinIcon}</button>
    </div>
  `;
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Recipe selection (click on tile, not the pin button)
  elements.recipeList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    
    // Handle pin button clicks
    const pinBtn = target.closest('.recipe-pin-btn') as HTMLElement;
    if (pinBtn?.dataset.pin) {
      e.stopPropagation();
      togglePin(pinBtn.dataset.pin);
      return;
    }
    
    // Handle tile selection
    const tile = target.closest('.recipe-tile') as HTMLElement;
    if (tile?.dataset.recipe) {
      selectRecipe(tile.dataset.recipe);
    }
  });
  
  // Remix buttons
  elements.remixReadBtn.addEventListener('click', () => applyRemix('library'));
  elements.remixSendBtn.addEventListener('click', () => applyRemix('none'));
  
  // Active remixes list - cancel button
  activeRemixesList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const cancelBtn = target.closest('.active-remix-cancel') as HTMLElement;
    if (cancelBtn) {
      const remixItem = cancelBtn.closest('.active-remix-item') as HTMLElement;
      if (remixItem?.dataset.requestId) {
        cancelRemix(remixItem.dataset.requestId);
      }
    }
  });
  
  // Clear stuck remixes link
  clearStuckLink.addEventListener('click', (e) => {
    e.preventDefault();
    clearStuckRemixes();
  });
  
  // Listen for progress updates from service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PROGRESS_UPDATE') {
      // Refresh active remixes display
      loadActiveRemixes();
    }
  });
}

/**
 * Select a recipe
 */
function selectRecipe(recipeId: string) {
  selectedRecipeId = recipeId;
  
  // Update tile states
  document.querySelectorAll('.recipe-tile').forEach((tile) => {
    tile.classList.toggle('active', (tile as HTMLElement).dataset.recipe === recipeId);
  });
  
  // Show/hide custom prompt
  elements.customPromptSection.style.display = recipeId === 'custom' ? 'block' : 'none';
}
/**
 * Apply AI remix to the page
 * @param navigate - 'library' opens library to in-progress item, 'none' closes popup silently
 */
async function applyRemix(navigate: 'library' | 'none') {
  const generateImages = elements.generateImages?.checked ?? false;
  
  try {
    const message: RemixMessage = {
      type: 'AI_ANALYZE',
      payload: {
        recipeId: selectedRecipeId,
        customPrompt: selectedRecipeId === 'custom' ? elements.customPrompt.value : undefined,
        generateImages,
        navigate,
      },
    };
    
    // Send message - service worker will track progress independently
    const response = await chrome.runtime.sendMessage(message);
    
    if (response?.success) {
      if (navigate === 'library') {
        // Open library and close popup
        const url = chrome.runtime.getURL('src/library/library.html');
        chrome.tabs.create({ url });
      }
      // Both options dismiss the popup
      window.close();
    } else if (response?.error) {
      showError(response.error);
    }
  } catch (error) {
    const errorMsg = String(error).replace('Error: ', '');
    showError(errorMsg);
  }
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show error message
 */
function showError(message: string) {
  elements.statusIndicator.textContent = 'Error';
  elements.statusIndicator.classList.add('error');
  elements.explanationText.textContent = `Error: ${message}`;
  elements.explanationSection.style.display = 'block';
  
  // Reset after delay
  setTimeout(() => {
    elements.statusIndicator.textContent = 'Ready';
    elements.statusIndicator.classList.remove('error');
  }, 5000);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);