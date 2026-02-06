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
  type ArticleSummary,
  type SavedArticle,
} from '../shared/storage-service';
import { BUILT_IN_RECIPES } from '../shared/recipes';

// ─── State ───────────────────────────────────────────
let articles: ArticleSummary[] = [];
let filteredArticles: ArticleSummary[] = [];
let selectedArticleId: string | null = null;
let currentArticle: SavedArticle | null = null;
let focusedIndex = -1;
let selectedRecipeId = 'focus';

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
const btnRespin = document.getElementById('btnRespin') as HTMLButtonElement;
const btnDelete = document.getElementById('btnDelete') as HTMLButtonElement;

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

// Delete modal
const deleteModal = document.getElementById('deleteModal') as HTMLElement;
const deleteArticleTitle = document.getElementById('deleteArticleTitle') as HTMLElement;
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn') as HTMLButtonElement;
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn') as HTMLButtonElement;

// ─── Init ────────────────────────────────────────────
async function init() {
  restorePreferences();
  populateRecipeFilters();
  setupEventListeners();
  restoreSidebarWidth();
  await loadArticles();

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
    articles = await getAllArticles();
    applyFilterAndSort();
    renderList();
    await updateFooter();
  } catch (err) {
    console.error('[Library] Failed to load articles:', err);
  }
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

  sidebarEmpty.classList.toggle('hidden', hasArticles);
  articleList.classList.toggle('hidden', !hasArticles);
  sidebarFooter.classList.toggle('hidden', !hasArticles);

  if (!hasArticles) {
    articleList.innerHTML = '';
    return;
  }

  if (!hasResults) {
    articleList.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <p>No matching articles</p>
      </div>
    `;
    return;
  }

  articleList.innerHTML = filteredArticles.map((article, index) => {
    const isActive = article.id === selectedArticleId;
    const isFocused = index === focusedIndex;
    const favStar = article.isFavorite
      ? '<span class="article-item-favorite">★</span>'
      : '';
    const recipe = BUILT_IN_RECIPES.find(r => r.id === article.recipeId);
    const recipeIcon = recipe?.icon ?? '📄';
    const recipeName = article.recipeName || recipe?.name || article.recipeId;
    const dateStr = formatRelativeDate(article.createdAt);

    return `
      <div class="article-item${isActive ? ' active' : ''}${isFocused ? ' focused' : ''}"
           data-id="${article.id}" data-index="${index}">
        <div class="article-item-title">${favStar}${escapeHtml(article.title)}</div>
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
  selectedArticleId = id;
  focusedIndex = filteredArticles.findIndex(a => a.id === id);

  // Update list highlight
  articleList.querySelectorAll('.article-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.id === id);
  });

  // Load full article
  try {
    currentArticle = await getArticle(id);
    if (!currentArticle) {
      console.warn('[Library] Article not found:', id);
      return;
    }

    // Update reading pane
    readingEmpty.classList.add('hidden');
    readingArticle.classList.remove('hidden');

    readingTitle.textContent = currentArticle.title;
    document.title = `${currentArticle.title} — Transmogrifier Library`;

    const domain = getDomain(currentArticle.originalUrl);
    const recipe = BUILT_IN_RECIPES.find(r => r.id === currentArticle!.recipeId);
    const recipeLabel = recipe ? `${recipe.icon} ${recipe.name}` : currentArticle.recipeName;
    const dateStr = formatRelativeDate(currentArticle.createdAt);
    readingInfo.textContent = `${domain}  ·  ${recipeLabel}  ·  ${dateStr}`;

    // Update favorite button
    favoriteIcon.textContent = currentArticle.isFavorite ? '★' : '☆';
    btnFavorite.classList.toggle('active', currentArticle.isFavorite);

    // Render content in iframe
    contentFrame.srcdoc = currentArticle.html;
    contentFrame.addEventListener('load', fixAnchorLinks, { once: true });

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
}

function clearSelection() {
  selectedArticleId = null;
  currentArticle = null;
  focusedIndex = -1;
  readingEmpty.classList.remove('hidden');
  readingArticle.classList.add('hidden');
  document.title = 'Transmogrifier Library';

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

function handleDeletePrompt() {
  if (!currentArticle) return;
  deleteArticleTitle.textContent = currentArticle.title;
  deleteModal.classList.remove('hidden');
}

async function handleDeleteConfirm() {
  if (!currentArticle) return;
  const id = currentArticle.id;
  deleteModal.classList.add('hidden');
  try {
    await deleteArticle(id);
    articles = articles.filter(a => a.id !== id);
    applyFilterAndSort();
    clearSelection();
    renderList();
    await updateFooter();
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

// ─── Event Setup ─────────────────────────────────────

function setupEventListeners() {
  // Article list click
  articleList.addEventListener('click', e => {
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
  btnDelete.addEventListener('click', handleDeletePrompt);
  btnRespin.addEventListener('click', openRespinModal);

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
      focusedIndex = Math.min(focusedIndex + 1, len - 1);
      updateFocusHighlight();
      break;
    }
    case 'ArrowUp':
    case 'k': {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
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
    case 'Delete': {
      if (currentArticle) {
        handleDeletePrompt();
        e.preventDefault();
      }
      break;
    }
  }

  // Ctrl+F / Cmd+F → focus search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
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

// ─── Start ───────────────────────────────────────────
init();
