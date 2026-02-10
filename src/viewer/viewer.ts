/**
 * Transmogrifier - Article Viewer
 * Displays saved articles from IndexedDB with respin capability
 */

import { getArticle, toggleFavorite, deleteArticle, exportArticleToFile, updateArticleShareStatus, SavedArticle } from '../shared/storage-service';
import { BUILT_IN_RECIPES } from '../shared/recipes';

// Get article ID from URL
const params = new URLSearchParams(window.location.search);
const articleId = params.get('id');

// DOM elements
const loadingState = document.getElementById('loadingState')!;
const errorState = document.getElementById('errorState')!;
const viewerState = document.getElementById('viewerState')!;
const articleTitle = document.getElementById('articleTitle')!;
const contentFrame = document.getElementById('contentFrame') as HTMLIFrameElement;
const favoriteBtn = document.getElementById('favoriteBtn')!;
const favoriteIcon = document.getElementById('favoriteIcon')!;
const exportBtn = document.getElementById('exportBtn')!;
const shareBtn = document.getElementById('shareBtn')!;
const originalBtn = document.getElementById('originalBtn')!;
const deleteBtn = document.getElementById('deleteBtn')!;
const respinBtn = document.getElementById('respinBtn')!;

// Respin modal elements
const respinModal = document.getElementById('respinModal')!;
const recipeSelect = document.getElementById('recipeSelect')!;
const customPromptSection = document.getElementById('customPromptSection')!;
const customPromptInput = document.getElementById('customPromptInput') as HTMLTextAreaElement;
const generateImagesCheck = document.getElementById('generateImagesCheck') as HTMLInputElement;
const cancelRespinBtn = document.getElementById('cancelRespinBtn')!;
const confirmRespinBtn = document.getElementById('confirmRespinBtn')!;

let currentArticle: SavedArticle | null = null;
let selectedRecipeId = 'focus';

async function init() {
  if (!articleId) {
    showError();
    return;
  }

  try {
    currentArticle = await getArticle(articleId);
    
    if (!currentArticle) {
      showError();
      return;
    }

    // Update UI
    document.title = `${currentArticle.title} - Transmogrifier`;
    articleTitle.textContent = currentArticle.title;
    favoriteIcon.textContent = currentArticle.isFavorite ? '★' : '☆';

    // Load content into iframe using srcdoc
    // Fix any leftover double-escaped Unicode sequences from older AI generations
    const cleanHtml = currentArticle.html.replace(
      /\\u([0-9a-fA-F]{4})/g,
      (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)),
    );
    contentFrame.srcdoc = cleanHtml;
    
    // Fix anchor links after iframe loads
    contentFrame.addEventListener('load', () => {
      fixAnchorLinks();
    });

    // Show viewer
    loadingState.classList.add('hidden');
    viewerState.classList.remove('hidden');

    // Set up event listeners
    setupEventListeners();

    // Update share button state
    updateViewerShareBtn();

  } catch (error) {
    console.error('[Viewer] Failed to load article:', error);
    showError();
  }
}

function showError() {
  loadingState.classList.add('hidden');
  errorState.classList.remove('hidden');
}

/**
 * Fix anchor links inside the iframe to scroll properly
 * Since srcdoc doesn't have a real URL, anchor navigation breaks
 */
function fixAnchorLinks() {
  try {
    const iframeDoc = contentFrame.contentDocument;
    if (!iframeDoc) return;
    
    // Find all anchor links that point to IDs on the same page
    const anchorLinks = iframeDoc.querySelectorAll('a[href^="#"]');
    
    anchorLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (!href || href === '#') return;
        
        const targetId = href.slice(1); // Remove the #
        const targetElement = iframeDoc.getElementById(targetId);
        
        if (targetElement) {
          e.preventDefault();
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
    
    console.log('[Viewer] Fixed', anchorLinks.length, 'anchor links');
  } catch (error) {
    console.warn('[Viewer] Could not fix anchor links:', error);
  }
}

function setupEventListeners() {
  // Favorite toggle
  favoriteBtn.addEventListener('click', async () => {
    if (!currentArticle) return;
    try {
      const isFavorite = await toggleFavorite(currentArticle.id);
      favoriteIcon.textContent = isFavorite ? '★' : '☆';
      currentArticle.isFavorite = isFavorite;
    } catch (error) {
      console.error('[Viewer] Failed to toggle favorite:', error);
    }
  });

  // Export to file
  exportBtn.addEventListener('click', async () => {
    if (!currentArticle) return;
    try {
      await exportArticleToFile(currentArticle.id);
    } catch (error) {
      console.error('[Viewer] Failed to export:', error);
      alert('Failed to export article');
    }
  });

  // Share article
  shareBtn.addEventListener('click', async () => {
    if (!currentArticle) return;

    if (currentArticle.sharedUrl) {
      // Already shared — copy link or unshare
      const action = confirm(
        `This article is shared at:\n${currentArticle.sharedUrl}\n\nClick OK to copy the link, or Cancel to unshare.`
      );
      if (action) {
        await navigator.clipboard.writeText(currentArticle.sharedUrl);
        shareBtn.textContent = '✓ Copied';
        setTimeout(() => updateViewerShareBtn(), 2000);
      } else {
        if (confirm('Unshare this article? The public link will stop working.')) {
          try {
            await chrome.runtime.sendMessage({
              type: 'UNSHARE_ARTICLE',
              payload: { articleId: currentArticle.id },
            });
            await updateArticleShareStatus(currentArticle.id, null);
            currentArticle = await getArticle(currentArticle.id);
            updateViewerShareBtn();
          } catch (err) {
            alert(`Unshare failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } else {
      // Not shared — share it
      shareBtn.setAttribute('disabled', '');
      shareBtn.textContent = 'Sharing…';
      try {
        const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days default
        const response = await chrome.runtime.sendMessage({
          type: 'SHARE_ARTICLE',
          payload: { articleId: currentArticle.id, expiresAt },
        });
        if (response?.success && response.shareResult) {
          await updateArticleShareStatus(currentArticle.id, {
            sharedUrl: response.shareResult.shareUrl,
            sharedBlobUrl: response.shareResult.blobUrl,
            shareShortCode: response.shareResult.shortCode,
            sharedAt: Date.now(),
            shareExpiresAt: expiresAt,
          });
          await navigator.clipboard.writeText(response.shareResult.shareUrl);
          currentArticle = await getArticle(currentArticle.id);
          updateViewerShareBtn();
          alert('Link copied to clipboard!');
        } else {
          alert(response?.error || 'Failed to share article');
        }
      } catch (err) {
        alert(`Share failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        shareBtn.removeAttribute('disabled');
        updateViewerShareBtn();
      }
    }
  });

  // Open original URL
  originalBtn.addEventListener('click', () => {
    if (!currentArticle) return;
    window.open(currentArticle.originalUrl, '_blank');
  });

  // Delete article
  deleteBtn.addEventListener('click', async () => {
    if (!currentArticle) return;
    if (!confirm('Delete this article? This cannot be undone.')) return;
    
    try {
      await deleteArticle(currentArticle.id);
      // Close this tab
      window.close();
      // If window.close() doesn't work (not opened by script), redirect
      setTimeout(() => {
        window.location.href = 'about:blank';
      }, 100);
    } catch (error) {
      console.error('[Viewer] Failed to delete:', error);
      alert('Failed to delete article');
    }
  });

  // Respin button - open modal
  respinBtn.addEventListener('click', openRespinModal);
  
  // Modal cancel
  cancelRespinBtn.addEventListener('click', closeRespinModal);
  
  // Modal confirm
  confirmRespinBtn.addEventListener('click', performRespin);
  
  // Close modal on overlay click
  respinModal.addEventListener('click', (e) => {
    if (e.target === respinModal) {
      closeRespinModal();
    }
  });
  
  // Recipe selection in modal
  recipeSelect.addEventListener('click', (e) => {
    const option = (e.target as HTMLElement).closest('.recipe-option') as HTMLElement;
    if (option) {
      selectRecipe(option.dataset.recipe!);
    }
  });

  // Listen for messages from the iframe (save button in generated HTML)
  window.addEventListener('message', async (event) => {
    if (event.data?.type === 'TRANSMOGRIFY_SAVE') {
      if (!currentArticle) return;
      try {
        await exportArticleToFile(currentArticle.id);
      } catch (error) {
        console.error('[Viewer] Failed to export from iframe:', error);
      }
    }
  });
}

/**
 * Open the respin modal
 */
function openRespinModal() {
  // Populate recipe options
  recipeSelect.innerHTML = BUILT_IN_RECIPES.map((recipe) => `
    <div class="recipe-option ${recipe.id === selectedRecipeId ? 'selected' : ''}" data-recipe="${recipe.id}">
      <span class="icon">${recipe.icon}</span>
      <span class="name">${recipe.name}</span>
    </div>
  `).join('');
  
  // Pre-select the recipe that was used for this article
  if (currentArticle) {
    selectedRecipeId = currentArticle.recipeId;
    selectRecipe(selectedRecipeId);
  }
  
  // Show modal
  respinModal.classList.remove('hidden');
}

/**
 * Close the respin modal
 */
function closeRespinModal() {
  respinModal.classList.add('hidden');
}

/**
 * Select a recipe in the modal
 */
function selectRecipe(recipeId: string) {
  selectedRecipeId = recipeId;
  
  // Update selection UI
  recipeSelect.querySelectorAll('.recipe-option').forEach((el) => {
    el.classList.toggle('selected', (el as HTMLElement).dataset.recipe === recipeId);
  });
  
  // Show/hide custom prompt field
  customPromptSection.style.display = recipeId === 'custom' ? 'block' : 'none';
}

/**
 * Perform the respin operation
 */
async function performRespin() {
  if (!currentArticle) return;
  
  // Disable button during operation
  confirmRespinBtn.setAttribute('disabled', 'true');
  confirmRespinBtn.textContent = '⏳ Respinning...';
  
  try {
    // Send respin request to service worker
    const response = await chrome.runtime.sendMessage({
      type: 'RESPIN_ARTICLE',
      payload: {
        articleId: currentArticle.id,
        recipeId: selectedRecipeId,
        customPrompt: selectedRecipeId === 'custom' ? customPromptInput.value : undefined,
        generateImages: generateImagesCheck.checked,
      },
    });
    
    if (response?.success && response.articleId) {
      // Redirect to the new article
      window.location.href = `viewer.html?id=${response.articleId}`;
    } else {
      throw new Error(response?.error || 'Respin failed');
    }
  } catch (error) {
    console.error('[Viewer] Respin failed:', error);
    alert(`Respin failed: ${error}`);
    confirmRespinBtn.removeAttribute('disabled');
    confirmRespinBtn.textContent = '✨ Respin';
  }
}

/**
 * Update the share button text/state in the viewer toolbar
 */
function updateViewerShareBtn() {
  if (currentArticle?.sharedUrl) {
    shareBtn.textContent = '🔗 Shared';
    shareBtn.title = 'Click to copy link or unshare';
  } else {
    shareBtn.textContent = '📤 Share';
    shareBtn.title = 'Share article';
  }
}

// Initialize
init();
