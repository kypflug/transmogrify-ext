/**
 * Content Extractor
 * Extracts semantic content from a page for AI-powered regeneration
 * Focuses on CONTENT not DOM structure
 */

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
  const metaAuthor = document.querySelector('meta[name="author"]')?.getAttribute('content');
  const ldJson = document.querySelector('script[type="application/ld+json"]');
  if (ldJson) {
    try {
      const data = JSON.parse(ldJson.textContent || '');
      if (data.author?.name) return data.author.name;
    } catch { /* ignore */ }
  }
  return metaAuthor || undefined;
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

  return blocks;
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
  const skipTags = ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'form', 'input', 'button'];
  if (skipTags.includes(tag)) return true;

  // Skip common ad/social/nav patterns (cheap string checks first)
  const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
  const id = el.id?.toLowerCase() || '';
  const skipPatterns = ['sidebar', 'comment', 'share', 'social', 'related', 'recommend', 'promo', 'ad-', 'ads-', 'advertisement', 'newsletter', 'subscribe', 'popup', 'modal', 'cookie', 'gdpr', 'nav', 'menu', 'footer', 'header', 'topic', 'follow', 'digest', 'trending', 'signup', 'sign-up', 'cta', 'banner', 'widget', 'toolbar', 'drawer', 'toast', 'snackbar', 'overlay'];

  for (const pattern of skipPatterns) {
    if (className.includes(pattern) || id.includes(pattern)) return true;
  }

  // Skip elements with ARIA roles that indicate non-content
  const role = el.getAttribute('role')?.toLowerCase() || '';
  const skipRoles = ['navigation', 'banner', 'complementary', 'contentinfo', 'dialog', 'alertdialog', 'toolbar', 'menu', 'menubar'];
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

  // Headings
  if (/^h[1-6]$/.test(tag)) {
    const text = el.textContent?.trim();
    if (text && text.length > 0) {
      processed.add(el);
      return {
        type: 'heading',
        level: parseInt(tag[1]),
        content: text,
      };
    }
  }

  // Paragraphs
  if (tag === 'p') {
    const text = el.textContent?.trim();
    if (text && text.length > 10) {
      processed.add(el);
      return {
        type: 'paragraph',
        content: preserveLinks(el),
      };
    }
  }

  // Images
  if (tag === 'img') {
    const img = el as HTMLImageElement;
    if (img.src && !img.src.includes('data:') && img.width > 100) {
      processed.add(el);
      return {
        type: 'image',
        content: '',
        src: img.src,
        alt: img.alt || '',
        caption: findCaption(el),
      };
    }
  }

  // Figure with image
  if (tag === 'figure') {
    const img = el.querySelector('img') as HTMLImageElement;
    const caption = el.querySelector('figcaption')?.textContent?.trim();
    if (img?.src) {
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
      return {
        type: 'image',
        content: '',
        src: img.src,
        alt: img.alt || '',
        caption: caption,
      };
    }
  }

  // Lists
  if (tag === 'ul' || tag === 'ol') {
    const items: string[] = [];
    el.querySelectorAll(':scope > li').forEach(li => {
      const text = li.textContent?.trim();
      if (text) items.push(text);
      processed.add(li);
    });
    if (items.length > 0) {
      processed.add(el);
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
    const text = el.textContent?.trim();
    if (text) {
      processed.add(el);
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
  if (tag === 'iframe') {
    const iframe = el as HTMLIFrameElement;
    const src = iframe.src;
    if (src && isContentIframe(src)) {
      processed.add(el);
      return {
        type: 'embed',
        content: `<iframe src="${src}" allowfullscreen loading="lazy"></iframe>`,
        src,
      };
    }
    // Non-content iframes (ads, trackers) — skip
    processed.add(el);
    return null;
  }

  // Div/span/section acting as a paragraph (has direct text, no block-level children)
  if (tag === 'div' || tag === 'section' || tag === 'span') {
    const text = el.textContent?.trim();
    if (text && text.length > 20) {
      // Only treat as paragraph if it has meaningful direct text content
      // and doesn't contain block-level children (which would be processed separately)
      const hasBlockChildren = el.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote, pre, figure, div');
      if (!hasBlockChildren) {
        processed.add(el);
        return {
          type: 'paragraph',
          content: preserveLinks(el),
        };
      }
    }
  }

  return null;
}

function preserveLinks(el: HTMLElement): string {
  // Convert element to text while preserving link information
  let result = '';
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as HTMLElement;
      if (child.tagName.toLowerCase() === 'a') {
        const href = child.getAttribute('href');
        const text = child.textContent;
        if (href && text) {
          result += `[${text}](${href})`;
        } else {
          result += text;
        }
      } else {
        result += child.textContent;
      }
    }
  });
  return result.trim();
}

function findCaption(img: HTMLElement): string | undefined {
  // Check for adjacent caption elements
  const next = img.nextElementSibling;
  if (next?.tagName.toLowerCase() === 'figcaption') {
    return next.textContent?.trim();
  }
  
  const parent = img.parentElement;
  if (parent?.tagName.toLowerCase() === 'figure') {
    const caption = parent.querySelector('figcaption');
    return caption?.textContent?.trim();
  }
  
  return undefined;
}

/**
 * Check whether an iframe src is content (video, demo, interactive)
 * vs non-content (ads, trackers, social widgets, etc.)
 */
function isContentIframe(src: string): boolean {
  const contentDomains = [
    'youtube.com', 'youtube-nocookie.com', 'youtu.be',
    'vimeo.com', 'player.vimeo.com',
    'dailymotion.com',
    'codepen.io',
    'jsfiddle.net',
    'codesandbox.io', 'stackblitz.com',
    'observable.com', 'observablehq.com',
    'glitch.com',
    'replit.com',
    'figma.com',
    'docs.google.com', 'drive.google.com',
    'google.com/maps', 'maps.google.com',
    'openstreetmap.org',
    'soundcloud.com',
    'spotify.com',
    'bandcamp.com',
    'archive.org',
    'ted.com',
    'loom.com',
    'wistia.com', 'fast.wistia.net',
    'twitch.tv', 'player.twitch.tv',
    'streamable.com',
    'giphy.com',
    'datawrapper.dwcdn.net',
    'flourish.studio', 'flo.uri.sh',
    'tableau.com',
    'd3js.org',
  ];

  try {
    const url = new URL(src);
    return contentDomains.some(domain => url.hostname.includes(domain));
  } catch {
    return false;
  }
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

  if (content.description) {
    lines.push(`> ${content.description}`, '');
  }

  if (content.author || content.publishDate) {
    const meta = [content.author, content.publishDate].filter(Boolean).join(' Ã¢â‚¬Â¢ ');
    lines.push(`*${meta}*`, '');
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
