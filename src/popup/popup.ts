/**
 * Focus Remix - Popup Script
 * Handles the extension popup UI for AI-powered remixing
 * With tabbed interface for Remix and Saved Articles
 */

import { RemixMessage } from '../shared/types';
import { BUILT_IN_RECIPES } from '../shared/recipes';
import { isAIConfigured, isImageConfigured } from '../shared/config';
import { ArticleSummary } from '../shared/storage-service';

// Progress state type (matches service worker)
interface RemixProgress {
  status: 'idle' | 'extracting' | 'analyzing' | 'generating-images' | 'saving' | 'complete' | 'error';
  step: string;
  error?: string;
  startTime?: number;
  pageTitle?: string;
  recipeId?: string;
  explanation?: string;
  articleId?: string;
}

// State
let selectedRecipeId = 'focus';
let isProcessing = false;

// DOM Elements - Tabs
const tabNav = document.querySelector('.tab-nav')!;
const remixTab = document.getElementById('remixTab')!;
const savedTab = document.getElementById('savedTab')!;
const articleCount = document.getElementById('articleCount')!;
const articlesList = document.getElementById('articlesList')!;
const emptyState = document.getElementById('emptyState')!;
const storageInfo = document.getElementById('storageInfo')!;

// DOM Elements - Remix
const elements = {
  statusIndicator: document.getElementById('statusIndicator')!,
  recipeGrid: document.getElementById('recipeGrid')!,
  customPromptSection: document.getElementById('customPromptSection')!,
  customPrompt: document.getElementById('customPrompt') as HTMLTextAreaElement,
  explanationSection: document.getElementById('explanationSection')!,
  explanationText: document.getElementById('explanationText')!,
  remixBtn: document.getElementById('remixBtn')!,
  loadingOverlay: document.getElementById('loadingOverlay')!,
  loadingText: document.getElementById('loadingText')!,
  errorText: document.getElementById('errorText')!,
  generateImages: document.getElementById('generateImages') as HTMLInputElement,
  imageToggleSection: document.querySelector('.image-toggle-section') as HTMLElement,
  // Progress steps
  stepExtract: document.getElementById('step-extract')!,
  stepAnalyze: document.getElementById('step-analyze')!,
  stepImages: document.getElementById('step-images')!,
  stepApply: document.getElementById('step-apply')!,
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
  
  // Check for ongoing operations (resilience feature)
  await checkExistingProgress();
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
 * Check if there's an ongoing operation and reconnect to it
 */
async function checkExistingProgress() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_PROGRESS' });
    if (response?.success && response.progress) {
      const progress: RemixProgress = response.progress;
      
      // If there's an active operation, show it
      if (progress.status !== 'idle') {
        displayProgress(progress);
      }
    }
  } catch (e) {
    console.log('[Popup] No existing progress');
  }
}

/**
 * Display progress state from storage
 */
function displayProgress(progress: RemixProgress) {
  if (progress.status === 'idle') {
    elements.loadingOverlay.style.display = 'none';
    elements.remixBtn.removeAttribute('disabled');
    return;
  }
  
  // Show we're processing
  isProcessing = true;
  elements.loadingOverlay.style.display = 'flex';
  elements.remixBtn.setAttribute('disabled', 'true');
  elements.loadingText.textContent = progress.step || 'Processing...';
  elements.errorText.style.display = 'none';
  
  // Reset all steps first
  [elements.stepExtract, elements.stepAnalyze, elements.stepImages, elements.stepApply].forEach(el => {
    el.classList.remove('active', 'done', 'error');
  });
  
  // Update step indicators based on status
  switch (progress.status) {
    case 'extracting':
      setStepStatus(elements.stepExtract, 'active');
      break;
    case 'analyzing':
      setStepStatus(elements.stepExtract, 'done');
      setStepStatus(elements.stepAnalyze, 'active');
      break;
    case 'generating-images':
      setStepStatus(elements.stepExtract, 'done');
      setStepStatus(elements.stepAnalyze, 'done');
      setStepStatus(elements.stepImages, 'active');
      elements.stepImages.classList.remove('hidden');
      break;
    case 'saving':
      setStepStatus(elements.stepExtract, 'done');
      setStepStatus(elements.stepAnalyze, 'done');
      setStepStatus(elements.stepApply, 'active');
      break;
    case 'complete':
      setStepStatus(elements.stepExtract, 'done');
      setStepStatus(elements.stepAnalyze, 'done');
      setStepStatus(elements.stepApply, 'done');
      elements.loadingText.textContent = 'Done! Article saved.';
      
      // Show explanation if available
      if (progress.explanation) {
        elements.explanationText.textContent = progress.explanation;
        elements.explanationSection.style.display = 'block';
      }
      
      elements.statusIndicator.textContent = 'Saved';
      elements.statusIndicator.classList.remove('error');
      elements.statusIndicator.classList.add('success');
      
      // Allow starting a new operation
      setTimeout(async () => {
        elements.loadingOverlay.style.display = 'none';
        elements.remixBtn.removeAttribute('disabled');
        isProcessing = false;
        await loadArticleCount(); // Update badge
        chrome.runtime.sendMessage({ type: 'RESET_PROGRESS' });
      }, 2000);
      break;
    case 'error':
      if (progress.error) {
        elements.errorText.textContent = progress.error;
        elements.errorText.style.display = 'block';
      }
      elements.loadingText.textContent = 'Error occurred';
      
      setTimeout(() => {
        elements.loadingOverlay.style.display = 'none';
        elements.remixBtn.removeAttribute('disabled');
        isProcessing = false;
        chrome.runtime.sendMessage({ type: 'RESET_PROGRESS' });
      }, 5000);
      break;
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
  
  // Listen for progress updates from service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PROGRESS_UPDATE' && message.progress) {
      displayProgress(message.progress);
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
 * Reset progress UI
 */
function resetProgress() {
  [elements.stepExtract, elements.stepAnalyze, elements.stepImages, elements.stepApply].forEach(el => {
    el.classList.remove('active', 'done', 'error');
    el.textContent = el.textContent?.replace(/^[✓✗⏳] /, '⏳ ') || '';
  });
  elements.errorText.style.display = 'none';
  elements.errorText.textContent = '';
  elements.explanationSection.style.display = 'none';
}

/**
 * Update a progress step
 */
function setStepStatus(step: HTMLElement, status: 'active' | 'done' | 'error', label?: string) {
  step.classList.remove('active', 'done', 'error');
  step.classList.add(status);
  
  const icons: Record<string, string> = { active: '⏳', done: '✓', error: '✗' };
  const baseLabel = label || step.textContent?.replace(/^[✓✗⏳] /, '') || '';
  step.textContent = `${icons[status]} ${baseLabel}`;
}

/**
 * Apply AI remix to the page
 */
async function applyRemix() {
  if (isProcessing) return;
  
  const generateImages = elements.generateImages?.checked ?? false;
  
  // Show loading and reset progress
  elements.loadingOverlay.style.display = 'flex';
  elements.remixBtn.setAttribute('disabled', 'true');
  isProcessing = true;
  resetProgress();
  
  // Hide images step if not generating
  elements.stepImages.classList.toggle('hidden', !generateImages);
  
  elements.loadingText.textContent = 'Starting remix...';
  
  try {
    setStepStatus(elements.stepExtract, 'active');
    
    const message: RemixMessage = {
      type: 'AI_ANALYZE',
      payload: {
        recipeId: selectedRecipeId,
        customPrompt: selectedRecipeId === 'custom' ? elements.customPrompt.value : undefined,
        generateImages,
      },
    };
    
    // Send message - service worker will update progress via storage
    const response = await chrome.runtime.sendMessage(message);
    
    if (response?.success) {
      setStepStatus(elements.stepApply, 'done');
      
      // Show explanation if available
      if (response.aiExplanation) {
        elements.explanationText.textContent = response.aiExplanation;
        elements.explanationSection.style.display = 'block';
      }
      
      elements.loadingText.textContent = 'Article saved!';
      
      // Update article count
      await loadArticleCount();
      
      // Brief delay to show completion before hiding
      await new Promise(r => setTimeout(r, 1500));
    } else {
      throw new Error(response?.error || 'Failed to apply remix');
    }
  } catch (error) {
    const errorMsg = String(error).replace('Error: ', '');
    elements.errorText.textContent = errorMsg;
    elements.errorText.style.display = 'block';
    
    // Mark current active step as error
    [elements.stepExtract, elements.stepAnalyze, elements.stepImages, elements.stepApply].forEach(el => {
      if (el.classList.contains('active')) {
        setStepStatus(el, 'error');
      }
    });
    
    showError(errorMsg);
    
    // Don't hide overlay immediately on error so user can see what failed
    await new Promise(r => setTimeout(r, 3000));
  } finally {
    elements.loadingOverlay.style.display = 'none';
    elements.remixBtn.removeAttribute('disabled');
    isProcessing = false;
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
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
