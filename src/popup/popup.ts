/**
 * Focus Remix - Popup Script
 * Handles the extension popup UI for AI-powered remixing
 * With tabbed interface for Remix and Saved Articles
 * Supports parallel remix operations
 */

import { RemixMessage, RemixRequest } from '../shared/types';
import { BUILT_IN_RECIPES } from '../shared/recipes';
import { isAIConfigured, isImageConfigured } from '../shared/config';
import { ArticleSummary } from '../shared/storage-service';

// State
let selectedRecipeId = 'focus';

// DOM Elements - Tabs
const tabNav = document.querySelector('.tab-nav')!;
const remixTab = document.getElementById('remixTab')!;
const savedTab = document.getElementById('savedTab')!;
const articleCount = document.getElementById('articleCount')!;
const articlesList = document.getElementById('articlesList')!;
const emptyState = document.getElementById('emptyState')!;
const storageInfo = document.getElementById('storageInfo')!;

// DOM Elements - Active Remixes
const activeRemixesSection = document.getElementById('activeRemixesSection')!;
const activeRemixesList = document.getElementById('activeRemixesList')!;
const activeCountEl = document.getElementById('activeCount')!;
const clearStuckLink = document.getElementById('clearStuck')!;

// DOM Elements - Remix
const elements = {
  statusIndicator: document.getElementById('statusIndicator')!,
  recipeGrid: document.getElementById('recipeGrid')!,
  customPromptSection: document.getElementById('customPromptSection')!,
  customPrompt: document.getElementById('customPrompt') as HTMLTextAreaElement,
  explanationSection: document.getElementById('explanationSection')!,
  explanationText: document.getElementById('explanationText')!,
  remixBtn: document.getElementById('remixBtn')!,
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

  // Render recipe buttons
  renderRecipes();
  
  // Set up event listeners
  setupEventListeners();
  
  // Load article count for badge
  await loadArticleCount();
  
  // Load active remixes
  await loadActiveRemixes();
  
  // Start polling for updates
  startPolling();
}

/**
 * Load article count for the tab badge
 */
async function loadArticleCount() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' });
    if (response?.success && response.stats) {
      articleCount.textContent = response.stats.count > 0 ? String(response.stats.count) : '';
    }
  } catch (e) {
    console.log('[Popup] Failed to load article count');
  }
}

/**
 * Load and display saved articles
 */
async function loadSavedArticles() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ARTICLES' });
    if (!response?.success) {
      console.error('[Popup] Failed to load articles:', response?.error);
      return;
    }

    const articles: ArticleSummary[] = response.articles || [];
    
    // Update storage info
    const statsResponse = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' });
    if (statsResponse?.success && statsResponse.stats) {
      const sizeMB = (statsResponse.stats.totalSize / (1024 * 1024)).toFixed(1);
      storageInfo.textContent = `${articles.length} articles • ${sizeMB} MB`;
    }

    // Show empty state or articles
    if (articles.length === 0) {
      articlesList.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    articlesList.style.display = 'block';
    
    // Render article list
    articlesList.innerHTML = articles.map((article) => {
      const date = new Date(article.createdAt);
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const sizeKB = Math.round(article.size / 1024);
      
      return `
        <div class="article-item" data-id="${article.id}">
          <div class="article-thumbnail">📄</div>
          <div class="article-info">
            <div class="article-title">${escapeHtml(article.title)}</div>
            <div class="article-meta">
              <span class="article-recipe">${escapeHtml(article.recipeName)}</span>
              <span>${dateStr}</span>
              <span>${sizeKB} KB</span>
            </div>
          </div>
          <div class="article-actions">
            <button class="article-action-btn favorite ${article.isFavorite ? 'active' : ''}" 
                    data-action="favorite" title="Favorite">
              ${article.isFavorite ? '★' : '☆'}
            </button>
            <button class="article-action-btn export" data-action="export" title="Save to file">
              💾
            </button>
            <button class="article-action-btn delete" data-action="delete" title="Delete">
              🗑️
            </button>
          </div>
        </div>
      `;
    }).join('');

  } catch (e) {
    console.error('[Popup] Error loading articles:', e);
  }
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
      
      return `
        <div class="active-remix-item ${statusClass}" data-request-id="${remix.requestId}">
          <div class="active-remix-icon">${statusIcon}</div>
          <div class="active-remix-info">
            <div class="active-remix-title">${escapeHtml(remix.pageTitle)}</div>
            <div class="active-remix-status">${remix.step}${elapsedStr}</div>
          </div>
          ${showCancel ? `<button class="active-remix-cancel" data-action="cancel">Cancel</button>` : ''}
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
 * Handle article actions (click, favorite, export, delete)
 */
async function handleArticleAction(articleId: string, action: string) {
  try {
    switch (action) {
      case 'open':
        await chrome.runtime.sendMessage({ 
          type: 'OPEN_ARTICLE', 
          payload: { articleId } 
        });
        break;
        
      case 'favorite':
        await chrome.runtime.sendMessage({ 
          type: 'TOGGLE_FAVORITE', 
          payload: { articleId } 
        });
        await loadSavedArticles(); // Refresh
        break;
        
      case 'export':
        await chrome.runtime.sendMessage({ 
          type: 'EXPORT_ARTICLE', 
          payload: { articleId } 
        });
        break;
        
      case 'delete':
        if (confirm('Delete this article?')) {
          await chrome.runtime.sendMessage({ 
            type: 'DELETE_ARTICLE', 
            payload: { articleId } 
          });
          await loadSavedArticles(); // Refresh
          await loadArticleCount(); // Update badge
        }
        break;
    }
  } catch (e) {
    console.error('[Popup] Article action failed:', e);
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
 * Switch between tabs
 */
function switchTab(tab: string) {
  // Update tab buttons
  tabNav.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
  });
  
  // Update tab content
  remixTab.classList.toggle('active', tab === 'remix');
  savedTab.classList.toggle('active', tab === 'saved');
  
  // Load articles when switching to saved tab
  if (tab === 'saved') {
    loadSavedArticles();
  }
}

/**
 * Render recipe selection buttons
 */
function renderRecipes() {
  elements.recipeGrid.innerHTML = BUILT_IN_RECIPES.map((recipe) => `
    <button class="recipe-btn ${recipe.id === selectedRecipeId ? 'active' : ''}" data-recipe="${recipe.id}">
      <span class="recipe-icon">${recipe.icon}</span>
      <span class="recipe-name">${recipe.name}</span>
    </button>
  `).join('');
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Tab navigation
  tabNav.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.tab-btn') as HTMLElement;
    if (btn?.dataset.tab) {
      switchTab(btn.dataset.tab);
    }
  });
  
  // Recipe selection
  elements.recipeGrid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.recipe-btn') as HTMLElement;
    if (btn) {
      selectRecipe(btn.dataset.recipe!);
    }
  });
  
  // Remix button
  elements.remixBtn.addEventListener('click', applyRemix);
  
  // Article list clicks
  articlesList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const articleItem = target.closest('.article-item') as HTMLElement;
    if (!articleItem) return;
    
    const articleId = articleItem.dataset.id!;
    const actionBtn = target.closest('.article-action-btn') as HTMLElement;
    
    if (actionBtn) {
      handleArticleAction(articleId, actionBtn.dataset.action!);
    } else {
      // Click on article row = open it
      handleArticleAction(articleId, 'open');
    }
  });
  
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
      loadArticleCount();
    }
  });
}

/**
 * Select a recipe
 */
function selectRecipe(recipeId: string) {
  selectedRecipeId = recipeId;
  
  // Update button states
  document.querySelectorAll('.recipe-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.recipe === recipeId);
  });
  
  // Show/hide custom prompt
  elements.customPromptSection.style.display = recipeId === 'custom' ? 'block' : 'none';
}
/**
 * Apply AI remix to the page
 */
async function applyRemix() {
  const generateImages = elements.generateImages?.checked ?? false;
  
  try {
    const message: RemixMessage = {
      type: 'AI_ANALYZE',
      payload: {
        recipeId: selectedRecipeId,
        customPrompt: selectedRecipeId === 'custom' ? elements.customPrompt.value : undefined,
        generateImages,
      },
    };
    
    // Send message - service worker will track progress independently
    const response = await chrome.runtime.sendMessage(message);
    
    if (response?.success) {
      // Refresh the active remixes list
      await loadActiveRemixes();
      await loadArticleCount();
      
      // Show explanation if available
      if (response.aiExplanation) {
        elements.explanationText.textContent = response.aiExplanation;
        elements.explanationSection.style.display = 'block';
      }
      
      elements.statusIndicator.textContent = 'Saved';
      elements.statusIndicator.classList.remove('error');
      elements.statusIndicator.classList.add('success');
      
      // Reset status after a delay
      setTimeout(() => {
        elements.statusIndicator.textContent = 'Ready';
        elements.statusIndicator.classList.remove('success');
      }, 3000);
    } else if (response?.error) {
      showError(response.error);
    }
  } catch (error) {
    const errorMsg = String(error).replace('Error: ', '');
    showError(errorMsg);
  }
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