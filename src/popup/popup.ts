/**
 * Focus Remix - Popup Script
 * Handles the extension popup UI for AI-powered remixing
 */

import { RemixMessage, RemixResponse } from '../shared/types';
import { BUILT_IN_RECIPES } from '../shared/recipes';
import { isAIConfigured, isImageConfigured } from '../shared/config';

// State
let selectedRecipeId = 'focus';
let isRemixActive = false;

// DOM Elements
const elements = {
  statusIndicator: document.getElementById('statusIndicator')!,
  recipeGrid: document.getElementById('recipeGrid')!,
  customPromptSection: document.getElementById('customPromptSection')!,
  customPrompt: document.getElementById('customPrompt') as HTMLTextAreaElement,
  explanationSection: document.getElementById('explanationSection')!,
  explanationText: document.getElementById('explanationText')!,
  remixBtn: document.getElementById('remixBtn')!,
  removeBtn: document.getElementById('removeBtn')!,
  loadingOverlay: document.getElementById('loadingOverlay')!,
  loadingText: document.querySelector('.loading-text') as HTMLElement,
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
  
  // Get current tab status
  const response = await sendMessage({ type: 'GET_STATUS' });
  if (response?.currentMode === 'ai') {
    isRemixActive = true;
    updateUI();
  }
  
  // Set up event listeners
  setupEventListeners();
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
  // Recipe selection
  elements.recipeGrid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.recipe-btn') as HTMLElement;
    if (btn) {
      selectRecipe(btn.dataset.recipe!);
    }
  });
  
  // Remix button
  elements.remixBtn.addEventListener('click', applyRemix);
  
  // Remove button
  elements.removeBtn.addEventListener('click', removeRemix);
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
  
  // Show loading
  elements.loadingOverlay.style.display = 'flex';
  elements.remixBtn.setAttribute('disabled', 'true');
  
  // Update loading text based on whether images are being generated
  if (generateImages) {
    elements.loadingText.textContent = 'Analyzing page & generating images...';
  } else {
    elements.loadingText.textContent = 'AI is analyzing the page...';
  }
  
  try {
    const message: RemixMessage = {
      type: 'AI_ANALYZE',
      payload: {
        recipeId: selectedRecipeId,
        customPrompt: selectedRecipeId === 'custom' ? elements.customPrompt.value : undefined,
        generateImages,
      },
    };
    
    const response = await sendMessage(message);
    
    if (response?.success) {
      isRemixActive = true;
      
      // Show explanation if available
      if (response.aiExplanation) {
        elements.explanationText.textContent = response.aiExplanation;
        elements.explanationSection.style.display = 'block';
      }
      
      updateUI();
    } else {
      showError(response?.error || 'Failed to apply remix');
    }
  } catch (error) {
    showError(String(error));
  } finally {
    elements.loadingOverlay.style.display = 'none';
    elements.remixBtn.removeAttribute('disabled');
  }
}

/**
 * Remove the current remix
 */
async function removeRemix() {
  try {
    const response = await sendMessage({ type: 'REMOVE_REMIX' });
    
    if (response?.success) {
      isRemixActive = false;
      elements.explanationSection.style.display = 'none';
      updateUI();
    }
  } catch (error) {
    showError(String(error));
  }
}

/**
 * Update UI based on current state
 */
function updateUI() {
  if (isRemixActive) {
    elements.statusIndicator.textContent = 'Active';
    elements.statusIndicator.classList.add('active');
    elements.statusIndicator.classList.remove('error');
    elements.removeBtn.style.display = 'block';
    elements.remixBtn.querySelector('.btn-text')!.textContent = 'Remix Again';
  } else {
    elements.statusIndicator.textContent = 'Ready';
    elements.statusIndicator.classList.remove('active', 'error');
    elements.removeBtn.style.display = 'none';
    elements.remixBtn.querySelector('.btn-text')!.textContent = 'Remix This Page';
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

/**
 * Send message to background script
 */
function sendMessage(message: RemixMessage): Promise<RemixResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RemixResponse) => {
      resolve(response);
    });
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
