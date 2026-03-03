/**
 * Content Extractor
 * Extracts semantic content from a page for AI-powered regeneration
 * Focuses on CONTENT not DOM structure
 */

import { isContentIframe, sanitizeAuthor } from '@kypflug/transmogrifier-core';

export interface ExtractedContent {
  title: string;
  description?: string;
  url: string;
  siteName?: string;
  favicon?: string;
  
  // Main content
  mainContent: ContentBlock[];
  
  // Design hints (colors, fonts detected on page)
  designHints: DesignHints;
  
  // Metadata
  author?: string;
  publishDate?: string;
  readingTime?: string;
  /** Source lede/abstract/subhed detected from the page (semantically separate from body) */
  lede?: string;
}

export interface ContentBlock {
  type: 'heading' | 'paragraph' | 'image' | 'list' | 'table' | 'code' | 'quote' | 'video' | 'embed' | 'divider';
  content: string;
  level?: number; // For headings (1-6)
  items?: string[]; // For lists
  ordered?: boolean; // For lists
  src?: string; // For images/videos
  alt?: string; // For images
  caption?: string; // For images/tables
  language?: string; // For code blocks
  rows?: string[][]; // For tables
  headers?: string[]; // For tables
}

export interface DesignHints {
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  fontFamily?: string;
  hasHeroImage?: boolean;
  isDarkMode?: boolean;
}

/**
 * Extract semantic content from the current page
 */
export function extractContent(): ExtractedContent {
  const content: ExtractedContent = {
    title: extractTitle(),
    url: window.location.href,
    description: extractDescription(),
    siteName: extractSiteName(),
    favicon: extractFavicon(),
    mainContent: extractMainContent(),
    designHints: extractDesignHints(),
    author: extractAuthor(),
    publishDate: extractPublishDate(),
  };

  // Strip leading blocks that duplicate the title/author/date metadata
  content.mainContent = stripLeadingMetaBlocks(
    content.mainContent, content.title, content.author, content.publishDate
  );

  // Detect and extract semantic lede (before image dedup, so position heuristics work)
  const ledeResult = detectLede(content.mainContent, content.description);
  if (ledeResult) {
    content.lede = ledeResult.text;
    content.mainContent = ledeResult.remainingBlocks;
  }

  // Deduplicate responsive image variants (same base URL, different crop/size params)
  content.mainContent = deduplicateImages(content.mainContent);

  // Estimate reading time
  const wordCount = content.mainContent
    .filter(b => b.type === 'paragraph' || b.type === 'heading')
    .reduce((sum, b) => sum + (b.content?.split(/\s+/).length || 0), 0);
  content.readingTime = `${Math.ceil(wordCount / 200)} min read`;

  return content;
}

function extractTitle(): string {
  // Try meta og:title first, then document title
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.getAttribute('content');
  const h1 = document.querySelector('h1')?.textContent?.trim();
  return ogTitle || twitterTitle || h1 || document.title || 'Untitled';
}

function extractDescription(): string | undefined {
  const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
  const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content');
  const twitterDesc = document.querySelector('meta[name="twitter:description"]')?.getAttribute('content');
  return ogDesc || metaDesc || twitterDesc || undefined;
}

function extractSiteName(): string | undefined {
  const ogSite = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  return ogSite || window.location.hostname;
}

function extractFavicon(): string | undefined {
  const link = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]') as HTMLLinkElement;
  if (link?.href) return link.href;
  return `${window.location.origin}/favicon.ico`;
}

function extractAuthor(): string | undefined {
  // 1. meta[name="author"]
  const metaAuthor = document.querySelector('meta[name="author"]')?.getAttribute('content');
  if (metaAuthor) return sanitizeAuthor(metaAuthor);

  // 2. meta[property="article:author"] (Open Graph)
  const ogAuthor = document.querySelector('meta[property="article:author"]')?.getAttribute('content');

  // 3. LD+JSON — check all scripts, handle arrays and @graph
  const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of ldScripts) {
    try {
      const data = JSON.parse(script.textContent || '');
      const name = extractAuthorFromLdJson(data);
      if (name) return sanitizeAuthor(name);
    } catch { /* ignore malformed JSON */ }
  }

  return sanitizeAuthor(ogAuthor || undefined);
}

/**
 * Dig author name out of a parsed LD+JSON blob.
 * Handles object, array-of-objects, and @graph structures.
 */
function extractAuthorFromLdJson(data: Record<string, unknown>): string | undefined {
  // Direct author field
  const author = data.author as unknown;
  if (author) {
    if (typeof author === 'string') return author;
    if (Array.isArray(author)) {
      const first = author[0];
      if (typeof first === 'string') return first;
      if (first?.name) return first.name as string;
    }
    if (typeof author === 'object' && (author as Record<string, unknown>).name) {
      return (author as Record<string, unknown>).name as string;
    }
  }

  // @graph array (schema.org)
  const graph = data['@graph'] as unknown[];
  if (Array.isArray(graph)) {
    for (const node of graph) {
      if (node && typeof node === 'object') {
        const name = extractAuthorFromLdJson(node as Record<string, unknown>);
        if (name) return name;
      }
    }
  }
  return undefined;
}

function extractPublishDate(): string | undefined {
  const metaDate = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content');
  const timeEl = document.querySelector('time[datetime]')?.getAttribute('datetime');
  return metaDate || timeEl || undefined;
}

/**
 * Find and extract main content from the page
 */
function extractMainContent(): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  
  // Try to find main content container
  const mainElement = findMainContent();
  if (!mainElement) {
    console.warn('[Transmogrifier] Could not find main content');
    return blocks;
  }

  // Walk through the main content and extract blocks
  const walker = document.createTreeWalker(
    mainElement,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        const el = node as HTMLElement;
        // Skip hidden elements, scripts, styles, nav, ads
        if (isHiddenOrSkipped(el)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const processedElements = new Set<Element>();
  let node: Node | null = walker.currentNode;
  
  while (node) {
    const el = node as HTMLElement;
    
    if (!processedElements.has(el)) {
      const block = elementToBlock(el, processedElements);
      if (block) {
        blocks.push(block);
      }
    }
    
    node = walker.nextNode();
  }

  return deduplicateContent(blocks);
}

// ─── Lede Detection ────────────────────────────────────────────────────────

/** Semantic CSS class patterns that indicate a lede/abstract/subhed element */
const LEDE_CLASS_PATTERNS = [
  'subtitle', 'subhead', 'subheadline', 'subhed', 'sub-headline',
  'lede', 'lead', 'standfirst', 'dek',
  'abstract', 'excerpt', 'summary-text',
  'article-subtitle', 'post-subtitle', 'entry-subtitle',
  'article-intro', 'intro-text', 'teaser',
];

/** Data attribute selectors for semantic lede elements */
const LEDE_DATA_SELECTORS = [
  '[data-type="abstract"]',
  '[data-component="standfirst"]',
  '[data-testid="article-subtitle"]',
  '[data-testid="standfirst"]',
];

interface LedeResult {
  text: string;
  remainingBlocks: ContentBlock[];
}

/**
 * Detect a semantic lede/abstract/subhed from the page content.
 *
 * Uses two tiers of detection (conservative to avoid false positives):
 *
 * Tier 1: Scan the DOM for elements with semantic CSS classes (subtitle,
 *         subhed, standfirst, dek, abstract, etc.) before the main content.
 *
 * Tier 2: If og:description closely matches the first content paragraph AND
 *         that paragraph is short (< 300 chars) and followed by an image or
 *         heading, treat it as a lede.
 *
 * Returns the lede text and the content blocks with the lede removed, or
 * null if no lede is detected.
 */
function detectLede(
  blocks: ContentBlock[],
  description?: string,
): LedeResult | null {
  // Tier 1: DOM-level semantic class detection
  const ledeFromDom = detectLedeFromDom();
  if (ledeFromDom) {
    // Find and remove the matching block from mainContent
    const normLede = normalizeForComparison(ledeFromDom);
    const idx = blocks.findIndex(b =>
      b.type === 'paragraph' &&
      normalizeForComparison(b.content) === normLede
    );
    if (idx >= 0 && idx < 5) {
      const remaining = [...blocks];
      remaining.splice(idx, 1);
      return { text: ledeFromDom, remainingBlocks: remaining };
    }
    // Even if we can't find an exact match in blocks, still return the DOM lede
    return { text: ledeFromDom, remainingBlocks: blocks };
  }

  // Tier 2: og:description matching first paragraph
  if (description && description.length > 20 && description.length < 300) {
    const firstParagraph = blocks.find(b => b.type === 'paragraph');
    if (firstParagraph) {
      const normDesc = normalizeForComparison(description);
      const normFirst = normalizeForComparison(firstParagraph.content);
      // Check for ≥80% overlap
      const shorter = normDesc.length <= normFirst.length ? normDesc : normFirst;
      const longer = normDesc.length > normFirst.length ? normDesc : normFirst;
      if (shorter.length > 0 && longer.includes(shorter) && shorter.length / longer.length > 0.8) {
        const firstIdx = blocks.indexOf(firstParagraph);
        // Verify structural separation: next non-empty block is an image or heading
        const nextBlock = blocks.slice(firstIdx + 1).find(b =>
          b.type !== 'divider' && (b.content?.trim() || b.src)
        );
        if (nextBlock && (nextBlock.type === 'image' || nextBlock.type === 'heading')) {
          const remaining = [...blocks];
          remaining.splice(firstIdx, 1);
          return { text: firstParagraph.content, remainingBlocks: remaining };
        }
      }
    }
  }

  return null;
}

/** Scan the DOM for lede-type elements before the main article body. */
function detectLedeFromDom(): string | null {
  const mainElement = findMainContent();
  const articleEl = document.querySelector('article') || mainElement;
  if (!articleEl) return null;

  // Look for elements with semantic lede classes in the article region
  for (const pattern of LEDE_CLASS_PATTERNS) {
    const candidates = articleEl.querySelectorAll(`[class*="${pattern}"]`);
    for (const el of candidates) {
      const text = (el as HTMLElement).textContent?.trim();
      if (text && text.length > 15 && text.length < 500) {
        return text;
      }
    }
  }

  // Try data-attribute selectors
  for (const selector of LEDE_DATA_SELECTORS) {
    const el = articleEl.querySelector(selector);
    if (el) {
      const text = (el as HTMLElement).textContent?.trim();
      if (text && text.length > 15 && text.length < 500) {
        return text;
      }
    }
  }

  // Also check the page header area outside the main content
  const headerEl = document.querySelector('header, .post-header, .article-header, .entry-header');
  if (headerEl && headerEl !== articleEl) {
    for (const pattern of LEDE_CLASS_PATTERNS) {
      const el = headerEl.querySelector(`[class*="${pattern}"]`);
      if (el) {
        const text = (el as HTMLElement).textContent?.trim();
        if (text && text.length > 15 && text.length < 500) {
          return text;
        }
      }
    }
  }

  return null;
}

/** Normalize text for fuzzy comparison: lowercase, collapse whitespace, strip punctuation. */
function normalizeForComparison(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim();
}

// ─── Responsive Image Deduplication ──────────────────────────────────────────

/**
 * Deduplicate responsive image variants: consecutive images sharing the same
 * base URL path (ignoring query parameters) are reduced to just the largest.
 */
function deduplicateImages(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type !== 'image' || !block.src) {
      result.push(block);
      i++;
      continue;
    }

    // Collect a run of consecutive image blocks with the same base URL
    const basePath = getImageBasePath(block.src);
    const group = [block];
    let j = i + 1;
    while (j < blocks.length && blocks[j].type === 'image' && blocks[j].src) {
      if (getImageBasePath(blocks[j].src!) === basePath) {
        group.push(blocks[j]);
        j++;
      } else {
        break;
      }
    }

    if (group.length > 1) {
      // Keep the variant with the largest dimensions
      const best = group.reduce((a, b) => {
        const aSize = getImageSizeFromUrl(a.src!);
        const bSize = getImageSizeFromUrl(b.src!);
        return (aSize.w * aSize.h) >= (bSize.w * bSize.h) ? a : b;
      });
      result.push(best);
    } else {
      result.push(block);
    }

    i = j;
  }

  return result;
}

/** Extract the URL path without query string or fragment. */
function getImageBasePath(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    // Fallback: strip everything after '?'
    return url.split('?')[0].split('#')[0];
  }
}

/** Extract width/height from common URL query parameters (w, h, width, height). */
function getImageSizeFromUrl(url: string): { w: number; h: number } {
  try {
    const params = new URL(url).searchParams;
    const w = parseInt(params.get('w') || params.get('width') || '0', 10) || 0;
    const h = parseInt(params.get('h') || params.get('height') || '0', 10) || 0;
    return { w, h };
  } catch {
    return { w: 0, h: 0 };
  }
}

/**
 * Remove near-duplicate content blocks.
 * Loosened extraction filters can let footer/repeated boilerplate through;
 * this pass keeps only the first occurrence of each normalised text.
 * Also catches substring duplicates — if a block's text is a substantial
 * portion (>60%) of an already-seen block, it's a fragment duplicate.
 */
function deduplicateContent(blocks: ContentBlock[]): ContentBlock[] {
  const seen = new Set<string>();
  const seenTexts: string[] = []; // For substring checks
  return blocks.filter(block => {
    // Only deduplicate text-bearing block types
    if (block.type === 'image' || block.type === 'video' || block.type === 'embed' || block.type === 'divider') {
      return true;
    }
    const text = (block.content || block.items?.join(' ') || '').trim();
    if (!text) return true;
    // Normalise: lowercase, collapse whitespace, strip punctuation
    const key = text.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
    if (!key) return true;
    // Exact duplicate check
    if (seen.has(key)) return false;
    // Substring duplicate check: drop blocks that are substantial fragments
    // of an already-seen block (catches span-inside-paragraph duplicates)
    if (key.length >= 30) {
      for (const prev of seenTexts) {
        const shorter = key.length <= prev.length ? key : prev;
        const longer = key.length > prev.length ? key : prev;
        if (longer.includes(shorter) && shorter.length / longer.length > 0.6) {
          return false;
        }
      }
    }
    seen.add(key);
    seenTexts.push(key);
    return true;
  });
}

/**
 * Strip leading content blocks that duplicate the page title, author, or publish date.
 *
 * Many CMS frameworks (Substack, WordPress, etc.) place the post header
 * (h1 title, subtitle, byline, date) inside the same <article> that contains
 * the body text. Since serializeContent() already prepends `# title` and
 * `*author • date*` from meta tags, these leading blocks would appear twice
 * in the AI prompt.
 *
 * We scan only the first N non-empty blocks (before real body content) and
 * remove blocks that look like metadata we already have.
 */
function stripLeadingMetaBlocks(
  blocks: ContentBlock[],
  title?: string,
  author?: string,
  publishDate?: string,
): ContentBlock[] {
  if (!blocks.length) return blocks;

  const norm = (s?: string) => s?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  const normTitle = norm(title);
  const normAuthor = norm(author);

  // ISO-ish date pattern (covers 2025-12-17T13:03:05.329Z and friendlier formats)
  const isoDateRe = /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;
  // Common byline prefixes
  const bylineRe = /^(by\b|published\b|posted\b|updated\b|written by\b)/i;

  const MAX_SCAN = 10; // only inspect the first N non-empty blocks
  let scanned = 0;
  let firstKept = -1;

  const keep = blocks.map((block, idx) => {
    // Once we've passed the header zone, keep everything
    if (firstKept >= 0 && idx - firstKept >= 2) return true;
    // Only scan up to MAX_SCAN non-empty blocks
    const text = (block.content ?? '').trim();
    if (!text) return true; // keep whitespace/divider blocks as-is
    if (scanned >= MAX_SCAN) return true;
    scanned++;

    const normText = norm(text);

    // Drop headings that match the title (>70% overlap either direction)
    if (block.type === 'heading' && normTitle) {
      const shorter = normText.length <= normTitle.length ? normText : normTitle;
      const longer = normText.length > normTitle.length ? normText : normTitle;
      if (longer.includes(shorter) && shorter.length / longer.length > 0.7) {
        return false;
      }
    }

    // Drop short paragraphs that look like metadata
    if (block.type === 'paragraph' && text.length < 200) {
      // Contains the author's name
      if (normAuthor && normAuthor.length > 2 && normText.includes(normAuthor)) return false;
      // Contains a raw ISO date
      if (isoDateRe.test(text)) return false;
      // Starts with a byline keyword
      if (bylineRe.test(text)) return false;
      // Contains the publish date string verbatim
      if (publishDate && norm(publishDate) && normText.includes(norm(publishDate))) return false;
    }

    // This block is real content — mark it
    if (firstKept < 0) firstKept = idx;
    return true;
  });

  return blocks.filter((_, i) => keep[i]);
}

function findMainContent(): Element | null {
  // Priority order for finding main content
  // Covers major CMS platforms: WordPress, Future plc, Vox Media, Medium, Substack, etc.
  const selectors = [
    '[data-article-body]',
    '#article-body',
    '.article-body',
    '.article__body',
    '.article-body__content',
    'main article',
    'article',
    'main',
    '[role="main"]',
    '#main-content',
    '#content',
    '#main',
    '.main-content',
    '.content',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.story-body',
    '.c-entry-content',
    '.article__content',
    '.post__content',
    '.rich-text',
    '[itemprop="articleBody"]',
    '[class*="article-body"]',
    '[class*="post-body"]',
    '[class*="entry-body"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 200) {
      return el;
    }
  }

  // Fallback: find largest text container
  const candidates = document.querySelectorAll('div, section');
  let best: Element | null = null;
  let bestScore = 0;

  candidates.forEach(el => {
    if (isHiddenOrSkipped(el as HTMLElement)) return;
    
    const text = el.textContent || '';
    const paragraphs = el.querySelectorAll('p').length;
    const score = text.length * 0.1 + paragraphs * 100;
    
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });

  return best || document.body;
}

function isHiddenOrSkipped(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  // Only skip elements that are almost never content — the LLM recipes
  // handle filtering out residual page chrome, so we err toward over-extracting.
  const skipTags = ['script', 'style', 'noscript', 'nav', 'form', 'input', 'button'];
  if (skipTags.includes(tag)) return true;

  // Skip unambiguous non-content patterns (keep the list tight — the AI
  // recipes already tell the LLM to discard site debris)
  const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
  const id = el.id?.toLowerCase() || '';
  const skipPatterns = [
    'sidebar', 'advertisement', 'popup', 'modal', 'cookie', 'gdpr', 'overlay',
    'related', 'recommended', 'more-stories', 'recirc', 'recirculation',
    'trending', 'popular', 'most-read', 'also-like', 'you-might-like',
    'c-recirculation', 'c-related',
  ];

  for (const pattern of skipPatterns) {
    if (className.includes(pattern) || id.includes(pattern)) return true;
  }

  // Skip elements with ARIA roles that clearly indicate non-content
  const role = el.getAttribute('role')?.toLowerCase() || '';
  const skipRoles = ['navigation', 'dialog', 'alertdialog'];
  if (skipRoles.includes(role)) return true;

  // Check HTML hidden attribute (avoids expensive getComputedStyle)
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;

  // Check inline style for display:none (cheaper than getComputedStyle)
  const inlineStyle = el.style;
  if (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden' || inlineStyle.opacity === '0') return true;

  return false;
}

function elementToBlock(el: HTMLElement, processed: Set<Element>): ContentBlock | null {
  const tag = el.tagName.toLowerCase();

  // Headings (native <hN> or ARIA role="heading" + aria-level)
  const ariaLevel = el.getAttribute('role') === 'heading'
    ? parseInt(el.getAttribute('aria-level') || '0', 10)
    : 0;
  if (/^h[1-6]$/.test(tag) || (ariaLevel >= 1 && ariaLevel <= 6)) {
    const text = preserveInlineMarkup(el);
    if (text.length > 0) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      return {
        type: 'heading',
        level: /^h[1-6]$/.test(tag) ? parseInt(tag[1]) : ariaLevel,
        content: text,
      };
    }
  }

  // Paragraphs — keep ALL non-empty paragraphs; the LLM recipe handles filtering
  if (tag === 'p') {
    const text = el.textContent?.trim();
    if (text) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      return {
        type: 'paragraph',
        content: preserveInlineMarkup(el),
      };
    }
  }

  // Images
  if (tag === 'img') {
    const img = el as HTMLImageElement;
    const resolvedSrc = resolveImageSrc(img);
    if (resolvedSrc && !resolvedSrc.includes('data:') && img.width > 100) {
      processed.add(el);
      return {
        type: 'image',
        content: '',
        src: resolvedSrc,
        alt: img.alt || '',
        caption: findCaption(el),
      };
    }
  }

  // Figure with image
  if (tag === 'figure') {
    const img = el.querySelector('img') as HTMLImageElement;
    const caption = el.querySelector('figcaption')?.textContent?.trim();
    if (img) {
      const resolvedSrc = resolveImageSrc(img);
      if (resolvedSrc) {
        processed.add(el);
        el.querySelectorAll('*').forEach(child => processed.add(child));
        return {
          type: 'image',
          content: '',
          src: resolvedSrc,
          alt: img.alt || '',
          caption: caption,
        };
      }
    }
  }

  // Lists
  if (tag === 'ul' || tag === 'ol') {
    const items: string[] = [];
    el.querySelectorAll(':scope > li').forEach(li => {
      const text = preserveInlineMarkup(li as HTMLElement);
      if (text) items.push(text);
      processed.add(li);
    });
    if (items.length > 0) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      return {
        type: 'list',
        content: '',
        items,
        ordered: tag === 'ol',
      };
    }
  }

  // Code blocks
  if (tag === 'pre' || (tag === 'code' && el.parentElement?.tagName.toLowerCase() !== 'pre')) {
    const code = el.querySelector('code') || el;
    const text = code.textContent?.trim();
    if (text && text.length > 10) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      const language = detectCodeLanguage(el);
      return {
        type: 'code',
        content: text,
        language,
      };
    }
  }

  // Blockquotes
  if (tag === 'blockquote') {
    const text = preserveInlineMarkup(el);
    if (text) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      return {
        type: 'quote',
        content: text,
      };
    }
  }

  // Tables
  if (tag === 'table') {
    const headers: string[] = [];
    const rows: string[][] = [];
    
    el.querySelectorAll('th').forEach(th => {
      headers.push(th.textContent?.trim() || '');
      processed.add(th);
    });
    
    el.querySelectorAll('tr').forEach(tr => {
      const cells: string[] = [];
      tr.querySelectorAll('td').forEach(td => {
        cells.push(td.textContent?.trim() || '');
        processed.add(td);
      });
      if (cells.length > 0) rows.push(cells);
      processed.add(tr);
    });

    if (rows.length > 0) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      return {
        type: 'table',
        content: '',
        headers: headers.length > 0 ? headers : undefined,
        rows,
      };
    }
  }

  // Horizontal rules
  if (tag === 'hr') {
    processed.add(el);
    return {
      type: 'divider',
      content: '',
    };
  }

  // Videos
  if (tag === 'video') {
    const video = el as HTMLVideoElement;
    const src = video.src || video.querySelector('source')?.src;
    if (src) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      return {
        type: 'video',
        content: '',
        src,
      };
    }
  }

  // Audio
  if (tag === 'audio') {
    const audio = el as HTMLAudioElement;
    const src = audio.src || audio.querySelector('source')?.src;
    if (src) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      return {
        type: 'embed',
        content: `<audio controls src="${src}"></audio>`,
        src,
      };
    }
  }

  // Inline SVGs (diagrams, animations, visualizations)
  if (tag === 'svg') {
    // Only preserve SVGs that are substantial (not tiny icons)
    const width = el.getAttribute('width') || el.getAttribute('viewBox')?.split(' ')[2];
    const height = el.getAttribute('height') || el.getAttribute('viewBox')?.split(' ')[3];
    const w = parseFloat(width || '0');
    const h = parseFloat(height || '0');
    if (w > 50 && h > 50) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      return {
        type: 'embed',
        content: el.outerHTML,
      };
    }
    // Small SVGs (icons) — skip silently
    processed.add(el);
    el.querySelectorAll('*').forEach(child => processed.add(child));
    return null;
  }

  // Iframes (YouTube, Vimeo, CodePen, etc.)
  // Emit as a video/link block — never as raw <iframe> HTML, because
  // iframes are blocked by the extension's CSP and by sandboxed viewers.
  if (tag === 'iframe') {
    const iframe = el as HTMLIFrameElement;
    const src = iframe.src;
    if (src && isContentIframe(src)) {
      processed.add(el);
      return {
        type: 'video',
        content: '',
        src,
      };
    }
    // Non-content iframes (ads, trackers) — skip
    processed.add(el);
    return null;
  }

  // Div/section acting as a paragraph (has direct text, no block-level children)
  // Note: <span> is excluded — it's an inline element whose content is already
  // captured by its parent's preserveInlineMarkup() call. Including it here caused
  // duplicate paragraph fragments on sites like Substack that wrap plain text in spans.
  if (tag === 'div' || tag === 'section') {
    const text = el.textContent?.trim();
    if (text && text.length > 20) {
      // Only treat as paragraph if it has meaningful direct text content
      // and doesn't contain block-level children (which would be processed separately)
      const hasBlockChildren = el.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote, pre, figure, div');
      if (!hasBlockChildren) {
        processed.add(el);
        el.querySelectorAll('*').forEach(child => processed.add(child));
        return {
          type: 'paragraph',
          content: preserveInlineMarkup(el),
        };
      }
    }
  }

  return null;
}

// Inline tags whose semantics should be preserved in extracted content
const PRESERVED_INLINE_TAGS = new Set([
  'em', 'i', 'strong', 'b', 'u', 'mark', 'code',
  'sub', 'sup', 's', 'del', 'ins', 'abbr',
]);

// Normalize presentational tags to their semantic equivalents
const TAG_NORMALIZE: Record<string, string> = {
  'i': 'em',
  'b': 'strong',
};

/**
 * Convert element to text while preserving inline formatting and links.
 * Links are serialized as markdown [text](url).
 * Inline emphasis/semantic tags are kept as HTML tags (e.g. <em>, <strong>).
 */
function preserveInlineMarkup(el: HTMLElement): string {
  return serializeInlineContent(el).trim();
}

function serializeInlineContent(el: HTMLElement): string {
  let result = '';
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as HTMLElement;
      const tag = child.tagName.toLowerCase();
      if (tag === 'a') {
        const href = child.getAttribute('href');
        const text = serializeInlineContent(child).trim();
        if (href && text) {
          // Footnote pattern: <a><sup>N</sup></a> → <sup>[N](#ref-N)</sup>
          const supMatch = /^<sup>(\d+)<\/sup>$/i.exec(text);
          if (supMatch) {
            result += `<sup>[${supMatch[1]}](#ref-${supMatch[1]})</sup>`;
          } else {
            // Self-referencing URL: link to same page → fragment-only
            const fragment = extractSelfFragment(href);
            if (fragment) {
              result += `[${text}](${fragment})`;
            } else {
              result += `[${text}](${href})`;
            }
          }
        } else {
          result += text;
        }
      } else if (tag === 'br') {
        result += '\n';
      } else if (PRESERVED_INLINE_TAGS.has(tag)) {
        const innerContent = serializeInlineContent(child);
        if (innerContent.trim()) {
          const outputTag = TAG_NORMALIZE[tag] || tag;
          result += `<${outputTag}>${innerContent}</${outputTag}>`;
        }
      } else {
        // Recurse into unrecognized elements (e.g. <span>) without wrapping
        result += serializeInlineContent(child);
      }
    }
  });
  return result;
}

/**
 * Detect when a link points back to the current page and return just the
 * fragment. Normalizes figure patterns (#F1, #fig1, #figure-1) to #fig-N.
 */
function extractSelfFragment(href: string): string | null {
  if (!href) return null;

  // Already a fragment-only link
  if (href.startsWith('#')) {
    return normalizeFigureFragment(href);
  }

  try {
    const linkUrl = new URL(href, window.location.href);
    const currentUrl = new URL(window.location.href);

    // Same origin + pathname → self-referencing link
    if (
      linkUrl.origin === currentUrl.origin &&
      linkUrl.pathname === currentUrl.pathname &&
      linkUrl.hash
    ) {
      return normalizeFigureFragment(linkUrl.hash);
    }
  } catch {
    // Malformed URL — not a self-reference
  }

  return null;
}

/** Normalize figure-like fragments (#F1, #fig1, #figure-1) to #fig-N. */
function normalizeFigureFragment(hash: string): string {
  const figMatch = /^#(?:fig(?:ure)?[-_]?|F)(\d+)$/i.exec(hash);
  if (figMatch) return `#fig-${figMatch[1]}`;
  return hash;
}

function findCaption(img: HTMLElement): string | undefined {
  // Walk up to 4 ancestor levels looking for a <figcaption>
  let node: Element | null = img;
  for (let depth = 0; depth < 4 && node; depth++) {
    // Check adjacent sibling first (at each level)
    const next = node.nextElementSibling;
    if (next?.tagName.toLowerCase() === 'figcaption') {
      const text = next.textContent?.trim();
      if (text) return text;
    }

    const parent: Element | null = node.parentElement;
    if (parent) {
      const fc = parent.querySelector('figcaption');
      if (fc) {
        const text = fc.textContent?.trim();
        if (text) return text;
      }
    }
    node = parent;
  }

  return undefined;
}

/** Lazy-loading data attributes, in priority order. */
const LAZY_SRC_ATTRS = [
  'data-src',
  'data-lazy-src',
  'data-original',
  'data-hi-res-src',
  'data-actualsrc',
  'data-delayed-url',
];

/** Known placeholder/tracking-pixel URL patterns. */
const PLACEHOLDER_PATTERNS = [
  /\/static\/\d+x\d+/i,
  /\/1x1\./i,
  /\/blank\./i,
  /\/placeholder/i,
  /\/spacer\./i,
  /\/pixel\./i,
  /\/grey\./i,
  /\/transparent\./i,
];

/** Known tracking/analytics URL patterns — never article content. */
const TRACKING_URL_PATTERNS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /\/collect\?/i,
  /doubleclick\.net/i,
  /facebook\.com\/tr/i,
  /bat\.bing\.com/i,
];

/**
 * Resolve the best available image URL for an <img> element.
 *
 * The extension runs in-browser, so `img.src` is the resolved property.
 * However, lazy-loaded images below the fold may not have had their
 * IntersectionObserver triggered, leaving `src` as a placeholder pixel.
 * This helper checks data attributes and srcset for the real URL.
 *
 * Returns the best URL found, or null if the image should be skipped.
 */
function resolveImageSrc(img: HTMLImageElement): string | null {
  const src = img.src;

  // Skip known tracking/analytics URLs
  if (src && TRACKING_URL_PATTERNS.some(p => p.test(src))) return null;

  // Check if the current src looks like a placeholder
  const isPlaceholder = !src
    || src.includes('data:')
    || img.naturalWidth <= 1
    || PLACEHOLDER_PATTERNS.some(p => p.test(src));

  if (isPlaceholder) {
    // Try lazy-loading data attributes
    for (const attr of LAZY_SRC_ATTRS) {
      const val = img.getAttribute(attr)?.trim();
      if (val && (val.startsWith('http') || val.startsWith('/'))) return val;
    }

    // Try srcset / data-srcset — take the first URL
    const srcset = img.getAttribute('data-srcset') || img.getAttribute('srcset');
    if (srcset) {
      const first = srcset.trim().split(/\s*,\s*/)[0];
      const url = first?.trim().split(/\s+/)[0];
      if (url && (url.startsWith('http') || url.startsWith('/'))) return url;
    }

    // Try parent <picture> element's <source> srcset
    const picture = img.closest('picture');
    if (picture) {
      const bestSrc = getBestSourceFromPicture(picture);
      if (bestSrc) return bestSrc;
    }

    // No lazy source found
    return null;
  }

  return src;
}

/**
 * Extract the best (highest-resolution) image URL from a <picture> element's
 * <source> children. Picks the URL with the largest `w` descriptor.
 */
function getBestSourceFromPicture(picture: Element): string | null {
  const sources = picture.querySelectorAll('source');
  let bestUrl: string | null = null;
  let bestWidth = 0;

  sources.forEach((source) => {
    const srcset = source.getAttribute('srcset');
    if (!srcset) return;

    for (const entry of srcset.split(',')) {
      const parts = entry.trim().split(/\s+/);
      const url = parts[0];
      const descriptor = parts[1] || '';
      const widthMatch = /^(\d+)w$/.exec(descriptor);
      const width = widthMatch ? parseInt(widthMatch[1], 10) : 0;

      if (url && (url.startsWith('http') || url.startsWith('/'))) {
        if (width > bestWidth || (!bestUrl && width === 0)) {
          bestUrl = url;
          bestWidth = width;
        }
      }
    }
  });

  // Fallback: first URL from first <source> srcset
  if (!bestUrl && sources.length > 0) {
    const srcset = sources[0].getAttribute('srcset');
    if (srcset) {
      const url = srcset.trim().split(/\s*,\s*/)[0]?.trim().split(/\s+/)[0];
      if (url && (url.startsWith('http') || url.startsWith('/'))) bestUrl = url;
    }
  }

  return bestUrl;
}


function detectCodeLanguage(el: HTMLElement): string | undefined {
  // Check class for language hints
  const classes = (el.className + ' ' + (el.querySelector('code')?.className || '')).toLowerCase();
  const match = classes.match(/(?:language-|lang-)(\w+)/);
  if (match) return match[1];
  
  // Check data attributes
  const lang = el.getAttribute('data-language') || el.getAttribute('data-lang');
  if (lang) return lang;
  
  return undefined;
}

/**
 * Extract design hints from the page
 */
/**
 * Convert RGB color to hex for cleaner output
 */
function simplifyColor(color: string): string | undefined {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return undefined;
  
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  
  // Return as hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function extractDesignHints(): DesignHints {
  const hints: DesignHints = {};
  
  // Get computed styles from body and main elements
  const bodyStyle = getComputedStyle(document.body);
  const mainEl = document.querySelector('main, article, [role="main"]');
  const mainStyle = mainEl ? getComputedStyle(mainEl) : bodyStyle;

  // Only capture simple solid colors, not gradients or complex values
  const bgColor = bodyStyle.backgroundColor;
  if (bgColor && bgColor.startsWith('rgb') && !bgColor.includes('gradient')) {
    hints.backgroundColor = simplifyColor(bgColor);
  }
  
  const textColor = mainStyle.color;
  if (textColor && textColor.startsWith('rgb')) {
    hints.textColor = simplifyColor(textColor);
  }
  
  // Only get the primary font family name
  const fontFamily = mainStyle.fontFamily?.split(',')[0]?.trim().replace(/["']/g, '');
  if (fontFamily && !fontFamily.includes('(') && fontFamily.length < 30) {
    hints.fontFamily = fontFamily;
  }

  // Detect if dark mode (reuse bgColor from above)
  if (bgColor) {
    const rgb = bgColor.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      const brightness = (parseInt(rgb[0]) + parseInt(rgb[1]) + parseInt(rgb[2])) / 3;
      hints.isDarkMode = brightness < 128;
    }
  }

  // Try to find accent/primary colors from links, buttons, etc.
  const link = document.querySelector('a');
  if (link) {
    const linkColor = getComputedStyle(link).color;
    if (linkColor && linkColor.startsWith('rgb')) {
      hints.accentColor = simplifyColor(linkColor);
    }
  }

  const button = document.querySelector('button, .btn, [class*="button"]');
  if (button) {
    const btnStyle = getComputedStyle(button);
    const btnBg = btnStyle.backgroundColor;
    if (btnBg && btnBg.startsWith('rgb') && btnBg !== 'rgba(0, 0, 0, 0)') {
      hints.primaryColor = simplifyColor(btnBg);
    }
  }

  // Check for hero image
  hints.hasHeroImage = !!document.querySelector(
    '[class*="hero"] img, [class*="banner"] img, header img, .featured-image'
  );

  return hints;
}

/**
 * Serialize extracted content to a compact string for AI
 */
export function serializeContent(content: ExtractedContent): string {
  const lines: string[] = [
    `# ${content.title}`,
    '',
  ];

  if (content.author || content.publishDate) {
    const meta = [content.author, content.publishDate].filter(Boolean).join(' • ');
    lines.push(`*${meta}*`, '');
  }

  // Retrieval date (when the remix was performed)
  lines.push(`Retrieved: ${new Date().toISOString().split('T')[0]}`, '');

  // Source lede/abstract/subhed (detected from the page)
  if (content.lede) {
    lines.push(`[LEDE]: ${content.lede}`, '');
  }

  for (const block of content.mainContent) {
    switch (block.type) {
      case 'heading':
        lines.push(`${'#'.repeat(block.level || 2)} ${block.content}`, '');
        break;
      case 'paragraph':
        lines.push(block.content, '');
        break;
      case 'image':
        lines.push(`![${block.alt || 'Image'}](${block.src})${block.caption ? ` *${block.caption}*` : ''}`, '');
        break;
      case 'list':
        block.items?.forEach((item, i) => {
          lines.push(block.ordered ? `${i + 1}. ${item}` : `- ${item}`);
        });
        lines.push('');
        break;
      case 'code':
        lines.push(`\`\`\`${block.language || ''}`, block.content, '```', '');
        break;
      case 'quote':
        lines.push(`> ${block.content}`, '');
        break;
      case 'table':
        if (block.headers?.length) {
          lines.push('| ' + block.headers.join(' | ') + ' |');
          lines.push('| ' + block.headers.map(() => '---').join(' | ') + ' |');
        }
        block.rows?.forEach(row => {
          lines.push('| ' + row.join(' | ') + ' |');
        });
        lines.push('');
        break;
      case 'divider':
        lines.push('---', '');
        break;
      case 'video':
        if (block.src) {
          lines.push(`[Video](${block.src})`, '');
        }
        break;
      case 'embed':
        if (block.content) {
          lines.push(block.content, '');
        } else if (block.src) {
          lines.push(`[Embedded content](${block.src})`, '');
        }
        break;
    }
  }

  // Add minimal design context (just for reference, AI should create its own design)
  lines.push('', '## Source Info');
  lines.push(`- URL: ${content.url}`);
  if (content.siteName) lines.push(`- Site: ${content.siteName}`);
  // Note: Don't include detailed design hints as AI should create fresh designs

  return lines.join('\n');
}
