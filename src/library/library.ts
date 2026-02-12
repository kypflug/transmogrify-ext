/**
 * Transmogrifier Library — Reader App
 * Two-pane article browser: list on left, reader on right
 */

import {
  getAllArticles,
  getArticle,
  deleteArticle,
  toggleFavorite,
  exportArticleToFile,
  getStorageStats,
  updateArticleShareStatus,
  type ArticleSummary,
  type SavedArticle,
} from '../shared/storage-service';
import { getMergedArticleList } from '../shared/sync-service';
import { resolveArticleImages } from '../shared/image-assets';
import { BUILT_IN_RECIPES } from '@kypflug/transmogrifier-core';
import type { RemixRequest } from '../shared/types';

// ─── State ───────────────────────────────────────────
let articles: (ArticleSummary & { cloudOnly?: boolean })[] = [];
let filteredArticles: (ArticleSummary & { cloudOnly?: boolean })[] = [];
let selectedArticleId: string | null = null;
let currentArticle: SavedArticle | null = null;
let focusedIndex = -1;
let selectedRecipeId = 'reader';
let activeRemixes: RemixRequest[] = [];
let selectedPendingId: string | null = null;
let activeBlobUrls: string[] = [];
let isSelectingArticle = false;

function releaseActiveBlobUrls(): void {
  for (const url of activeBlobUrls) {
    URL.revokeObjectURL(url);
  }
  activeBlobUrls = [];
}

window.addEventListener('beforeunload', () => {
  releaseActiveBlobUrls();
});

// Sidebar width persistence key
const SIDEBAR_WIDTH_KEY = 'library_sidebar_width';
const SORT_KEY = 'library_sort';
const FILTER_KEY = 'library_filter';

// ─── DOM refs ────────────────────────────────────────
const sidebar = document.getElementById('sidebar') as HTMLElement;
const articleList = document.getElementById('articleList') as HTMLElement;
const sidebarFooter = document.getElementById('sidebarFooter') as HTMLElement;
const sidebarEmpty = document.getElementById('sidebarEmpty') as HTMLElement;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchClear = document.getElementById('searchClear') as HTMLButtonElement;
const filterSelect = document.getElementById('filterSelect') as HTMLSelectElement;
const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement;

const readingEmpty = document.getElementById('readingEmpty') as HTMLElement;
const readingArticle = document.getElementById('readingArticle') as HTMLElement;
const readingTitle = document.getElementById('readingTitle') as HTMLElement;
const readingInfo = document.getElementById('readingInfo') as HTMLElement;
const contentFrame = document.getElementById('contentFrame') as HTMLIFrameElement;
const favoriteIcon = document.getElementById('favoriteIcon') as HTMLElement;

const btnFavorite = document.getElementById('btnFavorite') as HTMLButtonElement;
const btnExport = document.getElementById('btnExport') as HTMLButtonElement;
const btnOriginal = document.getElementById('btnOriginal') as HTMLButtonElement;
const btnNewTab = document.getElementById('btnNewTab') as HTMLButtonElement;
const btnRespin = document.getElementById('btnRespin') as HTMLButtonElement;
const btnDelete = document.getElementById('btnDelete') as HTMLButtonElement;
const btnShare = document.getElementById('btnShare') as HTMLButtonElement;

const resizeHandle = document.getElementById('resizeHandle') as HTMLElement;
const mobileBack = document.getElementById('mobileBack') as HTMLButtonElement;

// Respin modal
const respinModal = document.getElementById('respinModal') as HTMLElement;
const recipeSelect = document.getElementById('recipeSelect') as HTMLElement;
const customPromptSection = document.getElementById('customPromptSection') as HTMLElement;
const customPromptInput = document.getElementById('customPromptInput') as HTMLTextAreaElement;
const generateImagesCheck = document.getElementById('generateImagesCheck') as HTMLInputElement;
const cancelRespinBtn = document.getElementById('cancelRespinBtn') as HTMLButtonElement;
const confirmRespinBtn = document.getElementById('confirmRespinBtn') as HTMLButtonElement;

// Share modal
const shareModal = document.getElementById('shareModal') as HTMLElement;
const shareModalBody = document.getElementById('shareModalBody') as HTMLElement;
const shareModalFooter = document.getElementById('shareModalFooter') as HTMLElement;
const cancelShareBtn = document.getElementById('cancelShareBtn') as HTMLButtonElement;
const confirmShareBtn = document.getElementById('confirmShareBtn') as HTMLButtonElement;

// Delete modal
const deleteModal = document.getElementById('deleteModal') as HTMLElement;
const deleteArticleTitle = document.getElementById('deleteArticleTitle') as HTMLElement;
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn') as HTMLButtonElement;
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn') as HTMLButtonElement;

// Sync bar
const syncBarIcon = document.getElementById('syncBarIcon') as HTMLElement;
const syncBarText = document.getElementById('syncBarText') as HTMLElement;
const syncBarBtn = document.getElementById('syncBarBtn') as HTMLButtonElement;
const syncBarSettings = document.getElementById('syncBarSettings') as HTMLButtonElement;
const syncBarSignOut = document.getElementById('syncBarSignOut') as HTMLButtonElement;

// Progress reading pane
const readingProgress = document.getElementById('readingProgress') as HTMLElement;
const progressTitle = document.getElementById('progressTitle') as HTMLElement;
const progressRecipe = document.getElementById('progressRecipe') as HTMLElement;
const progressStep = document.getElementById('progressStep') as HTMLElement;
const progressElapsed = document.getElementById('progressElapsed') as HTMLElement;
const progressCancel = document.getElementById('progressCancel') as HTMLButtonElement;

// ─── Init ────────────────────────────────────────────
async function init() {
  restorePreferences();
  populateRecipeFilters();
  setupEventListeners();
  restoreSidebarWidth();
  await loadArticles();
  await loadActiveRemixes();
  await loadSyncStatus();

  // If URL has ?id=, pre-select that article
  const params = new URLSearchParams(window.location.search);
  const preselect = params.get('id');
  if (preselect) {
    await selectArticle(preselect);
  }
}

// ─── Data Loading ────────────────────────────────────

async function loadArticles() {
  try {
    // Use merged list (local + cloud-only) so synced articles appear even if not downloaded
    articles = await getMergedArticleList();
    applyFilterAndSort();
    renderList();
    await updateFooter();
  } catch (err) {
    console.error('[Library] Failed to load articles, falling back to local:', err);
    articles = await getAllArticles();
    applyFilterAndSort();
    renderList();
    await updateFooter();
  }
}

// ─── Active Remix Tracking ───────────────────────────

async function loadActiveRemixes() {
  try {
    const { activeRemixes: stored } = await chrome.storage.local.get('activeRemixes');
    const allRemixes: Record<string, RemixRequest> = stored || {};
    const inProgress = Object.values(allRemixes).filter(
      r => !['complete', 'error', 'idle'].includes(r.status)
    );

    // Check if a previously-tracked pending item just completed
    if (selectedPendingId) {
      const completed = allRemixes[selectedPendingId];
      if (completed && completed.status === 'complete' && completed.articleId) {
        selectedPendingId = null;
        activeRemixes = inProgress;
        renderList();
        await loadArticles();
        await selectArticle(completed.articleId);
        return;
      }
      if (!inProgress.find(r => r.requestId === selectedPendingId)) {
        // Pending item gone (error/cleaned up)
        selectedPendingId = null;
        readingProgress.classList.add('hidden');
        readingEmpty.classList.remove('hidden');
      }
    }

    // Only re-render if something changed
    const prevIds = activeRemixes.map(r => `${r.requestId}:${r.status}`).join(',');
    const newIds = inProgress.map(r => `${r.requestId}:${r.status}`).join(',');
    if (prevIds !== newIds) {
      activeRemixes = inProgress;
      renderList();
    }

    // Update progress pane if a pending item is selected
    if (selectedPendingId) {
      const remix = inProgress.find(r => r.requestId === selectedPendingId);
      if (remix) {
        showPendingProgress(remix);
      }
    }
  } catch {
    activeRemixes = [];
  }
}

function handleProgressUpdate(requestId: string, progress: RemixRequest) {
  // Update or insert in our active list
  const idx = activeRemixes.findIndex(r => r.requestId === requestId);
  if (['complete', 'error', 'idle'].includes(progress.status)) {
    // Remove from active list
    if (idx >= 0) activeRemixes.splice(idx, 1);
    // If this pending item was selected and it completed, select the new article
    if (selectedPendingId === requestId) {
      selectedPendingId = null;
      if (progress.status === 'complete' && progress.articleId) {
        // Reload articles then select the new one
        loadArticles().then(() => selectArticle(progress.articleId!));
        return;
      } else {
        // Error or idle — go back to empty state
        readingProgress.classList.add('hidden');
        readingEmpty.classList.remove('hidden');
      }
    }
  } else {
    if (idx >= 0) {
      activeRemixes[idx] = progress;
    } else {
      activeRemixes.push(progress);
    }
    // Update reading pane if this pending item is selected
    if (selectedPendingId === requestId) {
      showPendingProgress(progress);
    }
  }
  renderList();
}

function selectPendingRemix(requestId: string) {
  const remix = activeRemixes.find(r => r.requestId === requestId);
  if (!remix) return;

  // Deselect any real article
  selectedArticleId = null;
  currentArticle = null;
  selectedPendingId = requestId;

  // Update list highlight
  articleList.querySelectorAll('.article-item').forEach(el => el.classList.remove('active'));
  articleList.querySelectorAll('.article-item-pending').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.requestId === requestId);
  });

  showPendingProgress(remix);

  // Mobile: switch to reading view
  if (window.innerWidth < 900) {
    document.body.classList.add('mobile-reading');
  }
}

function showPendingProgress(remix: RemixRequest) {
  readingEmpty.classList.add('hidden');
  readingArticle.classList.add('hidden');
  readingProgress.classList.remove('hidden');

  progressTitle.textContent = remix.pageTitle || 'Transmogrifying…';

  const recipe = BUILT_IN_RECIPES.find(r => r.id === remix.recipeId);
  progressRecipe.textContent = recipe ? `${recipe.icon} ${recipe.name}` : remix.recipeId;

  const statusLabels: Record<string, string> = {
    'extracting': '📄 Extracting page content…',
    'analyzing': '🤖 AI is generating HTML…',
    'generating-images': '🎨 Generating images…',
    'saving': '💾 Saving article…',
  };
  progressStep.textContent = statusLabels[remix.status] || remix.step || remix.status;

  const elapsed = Math.round((Date.now() - remix.startTime) / 1000);
  progressElapsed.textContent = elapsed > 0 ? `${elapsed}s elapsed` : '';
}

function applyFilterAndSort() {
  const searchTerm = searchInput.value.trim().toLowerCase();
  const filterValue = filterSelect.value;
  const sortValue = sortSelect.value;

  // Filter
  let result = articles;
  if (filterValue === 'favorites') {
    result = result.filter(a => a.isFavorite);
  } else if (filterValue.startsWith('recipe:')) {
    const recipeId = filterValue.slice(7);
    result = result.filter(a => a.recipeId === recipeId);
  }

  // Search
  if (searchTerm) {
    result = result.filter(a =>
      a.title.toLowerCase().includes(searchTerm) ||
      a.recipeName.toLowerCase().includes(searchTerm)
    );
  }

  // Sort
  switch (sortValue) {
    case 'oldest':
      result = [...result].sort((a, b) => a.createdAt - b.createdAt);
      break;
    case 'alpha':
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'newest':
    default:
      // Already newest-first from getAllArticles
      break;
  }

  filteredArticles = result;
}

// ─── Rendering ───────────────────────────────────────

function renderList() {
  // Toggle empty state
  const hasArticles = articles.length > 0;
  const hasResults = filteredArticles.length > 0;
  const hasPending = activeRemixes.length > 0;

  sidebarEmpty.classList.toggle('hidden', hasArticles || hasPending);
  articleList.classList.toggle('hidden', !hasArticles && !hasPending);
  sidebarFooter.classList.toggle('hidden', !hasArticles);

  if (!hasArticles && !hasPending) {
    articleList.innerHTML = '';
    return;
  }

  // Render pending remixes at the top
  const pendingHtml = activeRemixes.map(remix => {
    const isActive = remix.requestId === selectedPendingId;
    const recipe = BUILT_IN_RECIPES.find(r => r.id === remix.recipeId);
    const recipeIcon = recipe?.icon ?? '📄';
    const recipeName = recipe?.name || remix.recipeId;
    const statusLabels: Record<string, string> = {
      'extracting': 'Extracting…',
      'analyzing': 'Generating…',
      'generating-images': 'Images…',
      'saving': 'Saving…',
    };
    const statusText = statusLabels[remix.status] || remix.step || remix.status;
    const title = remix.pageTitle || 'Transmogrifying…';

    return `
      <div class="article-item-pending${isActive ? ' active' : ''}"
           data-request-id="${remix.requestId}">
        <div class="pending-spinner"></div>
        <div class="pending-content">
          <div class="article-item-title">${escapeHtml(title)}</div>
          <div class="article-item-meta">
            <span class="article-item-recipe">${recipeIcon} ${escapeHtml(recipeName)}</span>
            <span class="article-item-dot">·</span>
            <span class="pending-status">${escapeHtml(statusText)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (!hasResults) {
    articleList.innerHTML = pendingHtml + `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <p>No matching articles</p>
      </div>
    `;
    return;
  }

  articleList.innerHTML = pendingHtml + filteredArticles.map((article, index) => {
    const isActive = article.id === selectedArticleId;
    const isFocused = index === focusedIndex;
    const favStar = article.isFavorite
      ? '<span class="article-item-favorite">★</span>'
      : '';
    const recipe = BUILT_IN_RECIPES.find(r => r.id === article.recipeId);
    const recipeIcon = recipe?.icon ?? '📄';
    const recipeName = article.recipeName || recipe?.name || article.recipeId;
    const dateStr = formatRelativeDate(article.createdAt);
    const cloudBadge = (article as any).cloudOnly
      ? '<span class="article-item-cloud" title="Stored in cloud">☁</span>'
      : '';

    return `
      <div class="article-item${isActive ? ' active' : ''}${isFocused ? ' focused' : ''}"
           data-id="${article.id}" data-index="${index}">
        <div class="article-item-title">${favStar}${cloudBadge}${escapeHtml(article.title)}</div>
        <div class="article-item-meta">
          <span class="article-item-recipe">${recipeIcon} ${escapeHtml(recipeName)}</span>
          <span class="article-item-dot">·</span>
          <span>${dateStr}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function updateFooter() {
  try {
    const stats = await getStorageStats();
    sidebarFooter.textContent = `${stats.count} article${stats.count !== 1 ? 's' : ''} · ${formatBytes(stats.totalSize)}`;
  } catch {
    sidebarFooter.textContent = '';
  }
}

// ─── Article Selection ───────────────────────────────

async function selectArticle(id: string) {
  // Skip if already displaying this article or if a selection is in progress
  if (id === selectedArticleId && currentArticle) return;
  if (isSelectingArticle) return;
  isSelectingArticle = true;

  try {
  selectedArticleId = id;
  selectedPendingId = null;
  focusedIndex = filteredArticles.findIndex(a => a.id === id);

  // Hide progress pane if it was showing
  readingProgress.classList.add('hidden');

  // Update list highlight
  articleList.querySelectorAll('.article-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.id === id);
  });

  // Load full article (download from cloud if needed)
  try {
    currentArticle = await getArticle(id);
    if (!currentArticle) {
      // Article may be cloud-only — try downloading
      const listEntry = articles.find(a => a.id === id);
      if (listEntry && (listEntry as any).cloudOnly) {
        readingEmpty.classList.add('hidden');
        readingArticle.classList.remove('hidden');
        readingTitle.textContent = listEntry.title;
        readingInfo.textContent = 'Downloading from cloud…';
        contentFrame.srcdoc = '';
        const response = await chrome.runtime.sendMessage({
          type: 'SYNC_DOWNLOAD_ARTICLE',
          payload: { articleId: id },
        });
        if (response?.success && response.article) {
          currentArticle = response.article;
          // Refresh list to remove cloud-only flag
          await loadArticles();
        } else {
          // Article no longer exists on OneDrive — refresh list to remove the stale entry
          readingInfo.textContent = 'Article no longer available';
          await loadArticles();
          return;
        }
      } else {
        console.warn('[Library] Article not found:', id);
        return;
      }
    }

    // At this point currentArticle is guaranteed set
    const article = currentArticle!;

    // Update reading pane
    readingEmpty.classList.add('hidden');
    readingArticle.classList.remove('hidden');

    readingTitle.textContent = article.title;

    const domain = getDomain(article.originalUrl);
    const recipe = BUILT_IN_RECIPES.find(r => r.id === article.recipeId);
    const recipeLabel = recipe ? `${recipe.icon} ${recipe.name}` : article.recipeName;
    const dateStr = formatRelativeDate(article.createdAt);
    readingInfo.textContent = `${domain}  ·  ${recipeLabel}  ·  ${dateStr}`;

    // Update favorite button
    favoriteIcon.textContent = article.isFavorite ? '★' : '☆';
    btnFavorite.classList.toggle('active', article.isFavorite);

    // Update share button state
    updateShareButtonState();

    // Render content in iframe (hide the save FAB — redundant with header save button)
    // Fix any leftover double-escaped Unicode sequences from older AI generations
    const cleanHtml = article.html.replace(
      /\\u([0-9a-fA-F]{4})/g,
      (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)),
    );

    // Resolve OneDrive image assets to blob URLs
    releaseActiveBlobUrls();
    let renderHtml = cleanHtml;
    try {
      const resolved = await resolveArticleImages(cleanHtml, article.images);
      renderHtml = resolved.html;
      activeBlobUrls = resolved.blobUrls;
    } catch (err) {
      console.warn('[Library] Failed to resolve image assets:', err);
    }

    const injectedStyles = '<style>'
      + '.remix-save-fab{display:none!important}'
      // Force JS-animated elements visible (sandbox blocks the IntersectionObserver)
      + '.io,.reveal,.cap{opacity:1!important;transform:none!important}'
      + '</style>';
    contentFrame.srcdoc = renderHtml.replace('</head>', injectedStyles + '</head>');
    contentFrame.addEventListener('load', () => {
      fixAnchorLinks();
      forwardIframeKeyboard();
    }, { once: true });

    // Mobile: switch to reading view
    if (window.innerWidth < 900) {
      document.body.classList.add('mobile-reading');
    }

    // Update URL without reload
    const url = new URL(window.location.href);
    url.searchParams.set('id', id);
    history.replaceState(null, '', url.toString());

  } catch (err) {
    console.error('[Library] Failed to load article:', err);
  }
  } finally {
    isSelectingArticle = false;
  }
}

function clearSelection() {
  selectedArticleId = null;
  selectedPendingId = null;
  currentArticle = null;
  focusedIndex = -1;
  releaseActiveBlobUrls();
  readingEmpty.classList.remove('hidden');
  readingArticle.classList.add('hidden');
  readingProgress.classList.add('hidden');
  document.title = 'Transmogrifications';

  articleList.querySelectorAll('.article-item').forEach(el => {
    el.classList.remove('active');
  });

  // Update URL
  const url = new URL(window.location.href);
  url.searchParams.delete('id');
  history.replaceState(null, '', url.toString());
}

// ─── Article Actions ─────────────────────────────────

async function handleFavorite() {
  if (!currentArticle) return;
  try {
    const isFav = await toggleFavorite(currentArticle.id);
    currentArticle.isFavorite = isFav;
    favoriteIcon.textContent = isFav ? '★' : '☆';
    btnFavorite.classList.toggle('active', isFav);
    // Update the summary in our list
    const summary = articles.find(a => a.id === currentArticle!.id);
    if (summary) summary.isFavorite = isFav;
    renderList();
  } catch (err) {
    console.error('[Library] Favorite toggle failed:', err);
  }
}

async function handleExport() {
  if (!currentArticle) return;
  try {
    await exportArticleToFile(currentArticle.id);
  } catch (err) {
    console.error('[Library] Export failed:', err);
  }
}

function handleOriginal() {
  if (!currentArticle) return;
  window.open(currentArticle.originalUrl, '_blank');
}

function handleNewTab() {
  if (!currentArticle) return;
  const blob = new Blob([currentArticle.html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

// ─── Share ───────────────────────────────────────────

function handleShareClick() {
  if (!currentArticle) return;

  if (currentArticle.sharedUrl) {
    // Already shared — show existing link with copy + unshare options
    shareModalBody.innerHTML = `
      <p>This article is shared:</p>
      <div class="share-url-row">
        <input type="text" class="share-url-input" id="shareUrlInput" value="${escapeAttr(currentArticle.sharedUrl)}" readonly>
        <button class="btn btn-secondary" id="copyShareUrlBtn" title="Copy to clipboard">📋</button>
      </div>
      ${currentArticle.shareExpiresAt ? `<p class="share-expires">Expires: ${new Date(currentArticle.shareExpiresAt).toLocaleDateString()}</p>` : ''}
    `;
    shareModalFooter.innerHTML = `
      <button class="modal-btn cancel" id="cancelShareBtn2">Close</button>
      <button class="modal-btn danger" id="unshareBtn">Unshare</button>
    `;
    // Wire up dynamic buttons
    document.getElementById('copyShareUrlBtn')!.addEventListener('click', () => {
      navigator.clipboard.writeText(currentArticle!.sharedUrl!).then(() => {
        document.getElementById('copyShareUrlBtn')!.textContent = '✓';
        setTimeout(() => { document.getElementById('copyShareUrlBtn')!.textContent = '📋'; }, 2000);
      });
    });
    document.getElementById('cancelShareBtn2')!.addEventListener('click', () => shareModal.classList.add('hidden'));
    document.getElementById('unshareBtn')!.addEventListener('click', handleUnshare);
  } else {
    // Not shared — show share form
    shareModalBody.innerHTML = `
      <p>Share this article with a public link. Anyone with the link can view it.</p>
      <div class="field-row">
        <label for="shareExpiration">Expires</label>
        <select id="shareExpiration">
          <option value="0">Never</option>
          <option value="7">7 days</option>
          <option value="30" selected>30 days</option>
          <option value="90">90 days</option>
        </select>
      </div>
    `;
    shareModalFooter.innerHTML = `
      <button class="modal-btn cancel" id="cancelShareBtn2">Cancel</button>
      <button class="modal-btn primary" id="confirmShareBtn2">📤 Share</button>
    `;
    document.getElementById('cancelShareBtn2')!.addEventListener('click', () => shareModal.classList.add('hidden'));
    document.getElementById('confirmShareBtn2')!.addEventListener('click', handleShareConfirm);
  }

  shareModal.classList.remove('hidden');
}

async function handleShareConfirm() {
  if (!currentArticle) return;

  const expirationDays = parseInt((document.getElementById('shareExpiration') as HTMLSelectElement)?.value || '0');
  const expiresAt = expirationDays > 0 ? Date.now() + expirationDays * 24 * 60 * 60 * 1000 : undefined;

  // Disable button and show progress
  const btn = document.getElementById('confirmShareBtn2') || confirmShareBtn;
  btn.setAttribute('disabled', '');
  btn.textContent = 'Sharing…';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SHARE_ARTICLE',
      payload: { articleId: currentArticle.id, expiresAt },
    });

    if (response?.success && response.shareResult) {
      // Update local article record
      await updateArticleShareStatus(currentArticle.id, {
        sharedUrl: response.shareResult.shareUrl,
        sharedBlobUrl: response.shareResult.blobUrl,
        shareShortCode: response.shareResult.shortCode,
        sharedAt: Date.now(),
        shareExpiresAt: expiresAt,
      });

      // Copy to clipboard
      await navigator.clipboard.writeText(response.shareResult.shareUrl);

      // Refresh currentArticle
      currentArticle = await getArticle(currentArticle.id);
      shareModal.classList.add('hidden');
      updateShareButtonState();

      // Show brief confirmation
      showShareToast('Link copied to clipboard!');
    } else {
      alert(response?.error || 'Failed to share article');
    }
  } catch (err) {
    alert(`Share failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btn.removeAttribute('disabled');
    btn.textContent = '📤 Share';
  }
}

async function handleUnshare() {
  if (!currentArticle?.shareShortCode) return;
  if (!confirm('Unshare this article? The public link will stop working.')) return;

  try {
    await chrome.runtime.sendMessage({
      type: 'UNSHARE_ARTICLE',
      payload: { articleId: currentArticle.id },
    });

    await updateArticleShareStatus(currentArticle.id, null);
    currentArticle = await getArticle(currentArticle.id);
    shareModal.classList.add('hidden');
    updateShareButtonState();
    showShareToast('Article unshared');
  } catch (err) {
    alert(`Unshare failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function updateShareButtonState() {
  if (currentArticle?.sharedUrl) {
    btnShare.classList.add('active');
    btnShare.title = 'Shared — click to manage';
  } else {
    btnShare.classList.remove('active');
    btnShare.title = 'Share article';
  }
}

function showShareToast(message: string) {
  // Create a temporary toast
  const toast = document.createElement('div');
  toast.className = 'share-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function handleDeletePrompt() {
  if (!currentArticle) return;
  deleteArticleTitle.textContent = currentArticle.title;
  deleteModal.classList.remove('hidden');
}

async function handleDeleteConfirm() {
  if (!currentArticle) return;
  const id = currentArticle.id;
  const deletedIndex = filteredArticles.findIndex(a => a.id === id);
  deleteModal.classList.add('hidden');
  try {
    await deleteArticle(id);
    articles = articles.filter(a => a.id !== id);
    applyFilterAndSort();
    renderList();
    await updateFooter();

    // Auto-select next article (or previous if we deleted the last one)
    if (filteredArticles.length > 0) {
      const nextIndex = Math.min(deletedIndex, filteredArticles.length - 1);
      focusedIndex = nextIndex;
      await selectArticle(filteredArticles[nextIndex].id);
      updateFocusHighlight();
    } else {
      clearSelection();
    }
  } catch (err) {
    console.error('[Library] Delete failed:', err);
  }
}

// ─── Respin ──────────────────────────────────────────

function openRespinModal() {
  if (!currentArticle) return;

  recipeSelect.innerHTML = BUILT_IN_RECIPES.map(recipe => `
    <div class="recipe-option ${recipe.id === selectedRecipeId ? 'selected' : ''}" data-recipe="${recipe.id}">
      <span class="icon">${recipe.icon}</span>
      <span class="name">${recipe.name}</span>
    </div>
  `).join('');

  selectedRecipeId = currentArticle.recipeId;
  selectRecipe(selectedRecipeId);
  respinModal.classList.remove('hidden');
}

function closeRespinModal() {
  respinModal.classList.add('hidden');
}

function selectRecipe(recipeId: string) {
  selectedRecipeId = recipeId;
  recipeSelect.querySelectorAll('.recipe-option').forEach(el => {
    el.classList.toggle('selected', (el as HTMLElement).dataset.recipe === recipeId);
  });
  customPromptSection.style.display = recipeId === 'custom' ? 'block' : 'none';
}

async function performRespin() {
  if (!currentArticle) return;
  confirmRespinBtn.setAttribute('disabled', 'true');
  confirmRespinBtn.textContent = '⏳ Respinning…';

  try {
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
      closeRespinModal();
      // Reload articles and select the new one
      await loadArticles();
      await selectArticle(response.articleId);
    } else {
      throw new Error(response?.error || 'Respin failed');
    }
  } catch (err) {
    console.error('[Library] Respin failed:', err);
    alert(`Respin failed: ${err}`);
  } finally {
    confirmRespinBtn.removeAttribute('disabled');
    confirmRespinBtn.textContent = '✨ Respin';
  }
}

// ─── Anchor Link Fixing ─────────────────────────────

function fixAnchorLinks() {
  try {
    const iframeDoc = contentFrame.contentDocument;
    if (!iframeDoc) return;
    const anchors = iframeDoc.querySelectorAll('a[href^="#"]');
    anchors.forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (!href || href === '#') return;
        const target = iframeDoc.getElementById(href.slice(1));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  } catch {
    // cross-origin — ignore
  }
}

/**
 * Forward keyboard shortcuts from the iframe to the parent so
 * j/k/f/Delete// work even when focus is in the article pane.
 */
function forwardIframeKeyboard() {
  try {
    const iframeDoc = contentFrame.contentDocument;
    if (!iframeDoc) return;
    iframeDoc.addEventListener('keydown', (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input inside the iframe
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const dominated = ['j', 'k', 'f', '/', 'ArrowDown', 'ArrowUp', 'Enter', 'Delete', 'Escape'];
      if (dominated.includes(e.key) || ((e.ctrlKey || e.metaKey) && e.key === 'f')) {
        e.preventDefault();
        // Re-dispatch on the parent document so handleKeyboard picks it up
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          bubbles: true,
        }));
      }
    });
  } catch {
    // cross-origin — ignore
  }
}

// ─── Event Setup ─────────────────────────────────────

function setupEventListeners() {
  // Article list click
  articleList.addEventListener('click', e => {
    // Check for pending item click
    const pendingItem = (e.target as HTMLElement).closest('.article-item-pending') as HTMLElement | null;
    if (pendingItem?.dataset.requestId) {
      selectPendingRemix(pendingItem.dataset.requestId);
      return;
    }
    const item = (e.target as HTMLElement).closest('.article-item') as HTMLElement | null;
    if (item?.dataset.id) {
      selectArticle(item.dataset.id);
    }
  });

  // Search
  let searchTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchClear.classList.toggle('hidden', searchInput.value === '');
      applyFilterAndSort();
      renderList();
    }, 200);
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    applyFilterAndSort();
    renderList();
    searchInput.focus();
  });

  // Filter & sort
  filterSelect.addEventListener('change', () => {
    persistPreferences();
    applyFilterAndSort();
    renderList();
  });
  sortSelect.addEventListener('change', () => {
    persistPreferences();
    applyFilterAndSort();
    renderList();
  });

  // Action buttons
  btnFavorite.addEventListener('click', handleFavorite);
  btnExport.addEventListener('click', handleExport);
  btnOriginal.addEventListener('click', handleOriginal);
  btnNewTab.addEventListener('click', handleNewTab);
  btnDelete.addEventListener('click', handleDeletePrompt);
  btnRespin.addEventListener('click', openRespinModal);
  btnShare.addEventListener('click', handleShareClick);

  // Share modal
  cancelShareBtn.addEventListener('click', () => shareModal.classList.add('hidden'));
  confirmShareBtn.addEventListener('click', handleShareConfirm);
  shareModal.addEventListener('click', e => {
    if (e.target === shareModal) shareModal.classList.add('hidden');
  });

  // Delete modal
  cancelDeleteBtn.addEventListener('click', () => deleteModal.classList.add('hidden'));
  confirmDeleteBtn.addEventListener('click', handleDeleteConfirm);
  deleteModal.addEventListener('click', e => {
    if (e.target === deleteModal) deleteModal.classList.add('hidden');
  });

  // Respin modal
  cancelRespinBtn.addEventListener('click', closeRespinModal);
  confirmRespinBtn.addEventListener('click', performRespin);
  respinModal.addEventListener('click', e => {
    if (e.target === respinModal) closeRespinModal();
  });
  recipeSelect.addEventListener('click', e => {
    const opt = (e.target as HTMLElement).closest('.recipe-option') as HTMLElement | null;
    if (opt?.dataset.recipe) selectRecipe(opt.dataset.recipe);
  });

  // Save button message from iframe
  window.addEventListener('message', async (event) => {
    if (event.data?.type === 'TRANSMOGRIFY_SAVE' && currentArticle) {
      try {
        await exportArticleToFile(currentArticle.id);
      } catch {
        // ignore
      }
    }
  });

  // Mobile back button
  mobileBack.addEventListener('click', () => {
    document.body.classList.remove('mobile-reading');
    clearSelection();
  });

  // Resize handle
  setupResize();

  // Keyboard navigation
  document.addEventListener('keydown', handleKeyboard);

  // Sync bar
  syncBarBtn.addEventListener('click', handleSyncNow);
  syncBarText.addEventListener('click', handleSyncSignIn);
  syncBarSignOut.addEventListener('click', handleSignOut);
  syncBarSettings.addEventListener('click', () => {
    const url = chrome.runtime.getURL('src/settings/settings.html');
    window.location.href = url;
  });

  // Listen for article changes and progress updates from service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ARTICLES_CHANGED') {
      console.log('[Library] Articles changed:', message.reason);
      loadArticles();
    } else if (message.type === 'PROGRESS_UPDATE' && message.requestId && message.progress) {
      handleProgressUpdate(message.requestId, message.progress);
    }
  });

  // Poll for active remixes every 2s — most reliable cross-context mechanism
  setInterval(() => loadActiveRemixes(), 2000);

  // Cancel pending remix
  progressCancel.addEventListener('click', async () => {
    if (!selectedPendingId) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'CANCEL_REMIX',
        payload: { requestId: selectedPendingId },
      });
    } catch {
      // ignore
    }
  });

  // Update elapsed time for pending items every second
  setInterval(() => {
    if (selectedPendingId) {
      const remix = activeRemixes.find(r => r.requestId === selectedPendingId);
      if (remix) {
        const elapsed = Math.round((Date.now() - remix.startTime) / 1000);
        progressElapsed.textContent = elapsed > 0 ? `${elapsed}s elapsed` : '';
      }
    }
  }, 1000);
}

// ─── Keyboard ────────────────────────────────────────

function handleKeyboard(e: KeyboardEvent) {
  // Don't intercept when typing in input/textarea
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (e.key === 'Escape') {
      (e.target as HTMLElement).blur();
      e.preventDefault();
    }
    return;
  }

  // Ctrl+F / Cmd+F → focus search (check before single-key handlers)
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  // Close modals on Escape
  if (e.key === 'Escape') {
    if (!respinModal.classList.contains('hidden')) {
      closeRespinModal();
      e.preventDefault();
      return;
    }
    if (!deleteModal.classList.contains('hidden')) {
      deleteModal.classList.add('hidden');
      e.preventDefault();
      return;
    }
    if (document.body.classList.contains('mobile-reading')) {
      document.body.classList.remove('mobile-reading');
      clearSelection();
      e.preventDefault();
      return;
    }
    return;
  }

  const len = filteredArticles.length;
  if (!len) return;

  switch (e.key) {
    case 'ArrowDown':
    case 'j': {
      e.preventDefault();
      const nextIdx = Math.min(focusedIndex + 1, len - 1);
      if (nextIdx !== focusedIndex || focusedIndex === -1) {
        focusedIndex = nextIdx === -1 ? 0 : nextIdx;
      }
      selectArticle(filteredArticles[focusedIndex].id);
      updateFocusHighlight();
      break;
    }
    case 'ArrowUp':
    case 'k': {
      e.preventDefault();
      const prevIdx = Math.max(focusedIndex - 1, 0);
      focusedIndex = prevIdx;
      selectArticle(filteredArticles[focusedIndex].id);
      updateFocusHighlight();
      break;
    }
    case 'Enter': {
      if (focusedIndex >= 0 && focusedIndex < len) {
        selectArticle(filteredArticles[focusedIndex].id);
      }
      break;
    }
    case 'f': {
      if (currentArticle) {
        handleFavorite();
        e.preventDefault();
      }
      break;
    }
    case '/': {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      break;
    }
    case 'Delete': {
      if (currentArticle) {
        handleDeletePrompt();
        e.preventDefault();
      }
      break;
    }
  }
}

function updateFocusHighlight() {
  articleList.querySelectorAll('.article-item').forEach(el => {
    const idx = parseInt((el as HTMLElement).dataset.index ?? '-1', 10);
    el.classList.toggle('focused', idx === focusedIndex);
    if (idx === focusedIndex) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

// ─── Sidebar Resize ──────────────────────────────────

function setupResize() {
  let isResizing = false;

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isResizing = true;
    resizeHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const min = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-min')) || 240;
    const max = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-max')) || 480;
    const width = Math.min(Math.max(e.clientX, min), max);
    sidebar.style.width = width + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    resizeHandle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Persist
    chrome.storage.local.set({ [SIDEBAR_WIDTH_KEY]: sidebar.offsetWidth });
  });
}

function restoreSidebarWidth() {
  chrome.storage.local.get(SIDEBAR_WIDTH_KEY, (result) => {
    const w = result[SIDEBAR_WIDTH_KEY];
    if (typeof w === 'number' && w >= 240 && w <= 480) {
      sidebar.style.width = w + 'px';
    }
  });
}

// ─── Preferences ─────────────────────────────────────

function persistPreferences() {
  chrome.storage.local.set({
    [SORT_KEY]: sortSelect.value,
    [FILTER_KEY]: filterSelect.value,
  });
}

function restorePreferences() {
  chrome.storage.local.get([SORT_KEY, FILTER_KEY], (result) => {
    if (result[SORT_KEY]) sortSelect.value = result[SORT_KEY];
    if (result[FILTER_KEY]) filterSelect.value = result[FILTER_KEY];
  });
}

function populateRecipeFilters() {
  // Add recipe-specific options to the filter dropdown
  BUILT_IN_RECIPES.forEach(recipe => {
    const opt = document.createElement('option');
    opt.value = `recipe:${recipe.id}`;
    opt.textContent = `${recipe.icon} ${recipe.name}`;
    filterSelect.appendChild(opt);
  });
}

// ─── Helpers ─────────────────────────────────────────

function formatRelativeDate(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minute = 60_000;
  const hour = 3600_000;
  const day = 86400_000;

  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 2 * day) return 'Yesterday';

  const d = new Date(ts);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Sync ────────────────────────────────────────────

async function loadSyncStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'SYNC_STATUS' });
    if (!response?.syncStatus) {
      syncBarBtn.classList.add('hidden');
      return;
    }

    const { signedIn, lastSyncTime, isSyncing, lastError } = response.syncStatus;

    if (!signedIn) {
      syncBarIcon.textContent = '☁️';
      syncBarText.textContent = 'Sign in to sync';
      syncBarText.classList.add('clickable');
      syncBarBtn.classList.add('hidden');
      syncBarSignOut.classList.add('hidden');
      return;
    }

    syncBarText.classList.remove('clickable');

    syncBarBtn.classList.remove('hidden');
    syncBarSignOut.classList.remove('hidden');

    if (isSyncing) {
      syncBarIcon.textContent = '🔄';
      syncBarText.textContent = 'Syncing…';
      syncBarBtn.classList.add('syncing');
    } else if (lastError) {
      syncBarIcon.textContent = '⚠️';
      syncBarText.textContent = `Sync error`;
      syncBarBtn.classList.remove('syncing');
    } else if (lastSyncTime) {
      syncBarIcon.textContent = '☁️';
      syncBarText.textContent = `Synced ${formatRelativeTime(lastSyncTime)}`;
      syncBarBtn.classList.remove('syncing');
    } else {
      syncBarIcon.textContent = '☁️';
      syncBarText.textContent = 'Not yet synced';
      syncBarBtn.classList.remove('syncing');
    }
  } catch {
    syncBarBtn.classList.add('hidden');
  }
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function handleSyncSignIn() {
  if (!syncBarText.classList.contains('clickable')) return;
  syncBarText.textContent = 'Signing in…';
  syncBarText.classList.remove('clickable');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'SYNC_SIGN_IN' });
    if (response?.success) {
      await loadSyncStatus();
      await loadArticles();
    } else {
      syncBarText.textContent = 'Sign in failed';
      syncBarText.classList.add('clickable');
    }
  } catch {
    syncBarText.textContent = 'Sign in failed';
    syncBarText.classList.add('clickable');
  }
}

async function handleSignOut() {
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_SIGN_OUT' });
    await loadSyncStatus();
    await loadArticles();
  } catch {
    // ignore
  }
}

async function handleSyncNow() {
  syncBarBtn.classList.add('syncing');
  syncBarText.textContent = 'Syncing…';
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
    await loadSyncStatus();
    await loadArticles();
  } catch {
    syncBarBtn.classList.remove('syncing');
    syncBarText.textContent = 'Sync failed';
  }
}

// ─── Start ───────────────────────────────────────────
init();
