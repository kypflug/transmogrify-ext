/**
 * Server-side Content Extractor
 * 
 * Fetches a URL and extracts clean article content using Mozilla's Readability.
 * Uses linkedom instead of jsdom for a much smaller deployment footprint.
 */

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export interface ExtractedContent {
  title: string;
  url: string;
  siteName?: string;
  author?: string;
  excerpt?: string;
  /** Serialized content in a format suitable for the AI prompt */
  content: string;
  /** Content length in characters */
  contentLength: number;
}

/**
 * Fetch a URL and extract its main content
 */
export async function fetchAndExtract(url: string): Promise<ExtractedContent> {
  // Fetch the page with a realistic user agent
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000), // 30s timeout
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL (${response.status}): ${response.statusText}`);
  }

  const html = await response.text();

  // Parse with linkedom (lightweight DOM)
  const { document } = parseHTML(html);

  // Set document URL for Readability
  // linkedom doesn't support setting URL directly, but Readability handles relative URLs

  // Extract with Readability
  const reader = new Readability(document as any, {
    charThreshold: 100,
  });
  const article = reader.parse();

  if (!article || !article.textContent?.trim()) {
    throw new Error('Could not extract readable content from the page');
  }

  // Build a structured content representation similar to what the 
  // extension's content extractor produces
  const contentParts: string[] = [];

  // Title
  const title = article.title || document.title || 'Untitled';
  contentParts.push(`# ${title}`);

  // Metadata
  if (article.byline) {
    contentParts.push(`Author: ${article.byline}`);
  }
  const siteName = extractSiteName(document as any, url);
  if (siteName) {
    contentParts.push(`Source: ${siteName}`);
  }
  contentParts.push(`URL: ${url}`);
  contentParts.push('');

  // Main content — Readability gives us sanitized HTML; convert to a
  // simplified text-with-structure format the AI can work with
  const contentHtml = article.content || '';
  const contentText = htmlToStructuredText(contentHtml);

  contentParts.push(contentText);

  const content = contentParts.join('\n');

  return {
    title,
    url,
    siteName: siteName || undefined,
    author: article.byline || undefined,
    excerpt: article.excerpt || undefined,
    content,
    contentLength: content.length,
  };
}

/**
 * Convert sanitized HTML to structured text for the AI prompt
 */
function htmlToStructuredText(html: string): string {
  const { document: doc } = parseHTML(html);
  const parts: string[] = [];

  // linkedom puts fragment content (like Readability's output, which starts
  // with <DIV class="page">) into documentElement, NOT body.
  // Use body if it has children, otherwise fall back to documentElement.
  const root = doc.body?.childNodes?.length ? doc.body : doc.documentElement ?? doc.body;

  function walk(node: Node) {
    if (node.nodeType === 3) {
      // Text node
      const text = node.textContent?.trim();
      if (text) parts.push(text);
      return;
    }

    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    switch (tag) {
      case 'h1': parts.push(`\n# ${el.textContent?.trim()}`); break;
      case 'h2': parts.push(`\n## ${el.textContent?.trim()}`); break;
      case 'h3': parts.push(`\n### ${el.textContent?.trim()}`); break;
      case 'h4': parts.push(`\n#### ${el.textContent?.trim()}`); break;
      case 'h5': parts.push(`\n##### ${el.textContent?.trim()}`); break;
      case 'h6': parts.push(`\n###### ${el.textContent?.trim()}`); break;
      case 'p':
        parts.push(`\n${el.textContent?.trim()}`);
        break;
      case 'blockquote':
        parts.push(`\n> ${el.textContent?.trim()}`);
        break;
      case 'pre':
      case 'code':
        parts.push(`\n\`\`\`\n${el.textContent?.trim()}\n\`\`\``);
        break;
      case 'ul':
      case 'ol':
        el.querySelectorAll(':scope > li').forEach((li, i) => {
          const prefix = tag === 'ol' ? `${i + 1}.` : '-';
          parts.push(`${prefix} ${li.textContent?.trim()}`);
        });
        break;
      case 'img': {
        const src = el.getAttribute('src');
        const alt = el.getAttribute('alt') || '';
        if (src) parts.push(`\n[Image: ${alt}](${src})`);
        break;
      }
      case 'a': {
        const href = el.getAttribute('href');
        const text = el.textContent?.trim();
        if (href && text) {
          parts.push(`[${text}](${href})`);
        } else {
          for (const child of el.childNodes) walk(child);
        }
        break;
      }
      case 'figure': {
        const img = el.querySelector('img');
        const caption = el.querySelector('figcaption');
        if (img) {
          const src = img.getAttribute('src');
          const alt = img.getAttribute('alt') || caption?.textContent?.trim() || '';
          if (src) parts.push(`\n[Image: ${alt}](${src})`);
        }
        if (caption && !img) {
          parts.push(`\nCaption: ${caption.textContent?.trim()}`);
        }
        break;
      }
      case 'table': {
        parts.push('\n[Table]');
        const rows = el.querySelectorAll('tr');
        rows.forEach(row => {
          const cells = Array.from(row.querySelectorAll('th, td'))
            .map(c => c.textContent?.trim())
            .join(' | ');
          parts.push(`| ${cells} |`);
        });
        break;
      }
      case 'hr':
        parts.push('\n---');
        break;
      default:
        for (const child of el.childNodes) walk(child);
    }
  }

  walk(root);
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract site name from meta tags or URL
 */
function extractSiteName(document: Document, url: string): string | null {
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) return ogSiteName.getAttribute('content');

  const applicationName = document.querySelector('meta[name="application-name"]');
  if (applicationName) return applicationName.getAttribute('content');

  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return null;
  }
}
