import { FAST_DETERMINISTIC_TEMPLATE } from '@kypflug/transmogrifier-core';

interface DeterministicRenderInput {
  title: string;
  sourceUrl: string;
  content: string;
}

export function renderDeterministicHtml(input: DeterministicRenderInput): string {
  const cleanedContent = normalizeContent(input.content, input.title);
  const contentHtml = structuredTextToHtml(cleanedContent, input.title, input.sourceUrl);
  const title = input.title || 'Untitled';
  const meta = input.sourceUrl || '';

  return FAST_DETERMINISTIC_TEMPLATE
    .replaceAll('{TITLE}', escapeHtml(title))
    .replace('{META}', escapeHtml(meta))
    .replace('{EXCERPT}', '')
    .replace('{CONTENT}', contentHtml);
}

function structuredTextToHtml(content: string, title: string, sourceUrl: string): string {
  const lines = content.split(/\r?\n/);
  const blocks: string[] = [];
  let paragraphBuffer: string[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let codeFenceOpen = false;
  let codeBuffer: string[] = [];
  let skipDetritusSection = false;

  const DETRITUS_SECTIONS = new Set(['most popular', 'source info']);

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').trim();
    if (text) blocks.push(`<p>${renderInline(text, sourceUrl)}</p>`);
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    blocks.push(`<${listType}>${listItems.join('')}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushCode = () => {
    if (codeBuffer.length === 0) return;
    const code = codeBuffer.join('\n').replace(/\n+$/, '');
    blocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    codeBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^```/.test(line)) {
      if (codeFenceOpen) {
        flushCode();
        codeFenceOpen = false;
      } else {
        flushParagraph();
        flushList();
        codeFenceOpen = true;
      }
      continue;
    }

    if (codeFenceOpen) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const headingText = headingMatch[2].trim();

      // Skip noisy tail sections often scraped from source pages.
      const headingNorm = headingText.toLowerCase().trim();
      if (DETRITUS_SECTIONS.has(headingNorm)) {
        skipDetritusSection = true;
        continue;
      }
      skipDetritusSection = false;

      if (headingText !== title) {
        const level = Math.min(6, headingMatch[1].length + 1);
        blocks.push(`<h${level}>${renderInline(headingText, sourceUrl)}</h${level}>`);
      }
      continue;
    }

    if (skipDetritusSection) {
      continue;
    }

    const imageMatch = /^\[Image:\s*(.*?)\]\(([^)]+)\)$/i.exec(line) || /^!\[(.*?)\]\(([^)]+)\)$/.exec(line);
    if (imageMatch) {
      flushParagraph();
      flushList();
      const alt = imageMatch[1].trim() || 'Article image';
      const src = safeUrl(imageMatch[2].trim(), sourceUrl);
      if (src) {
        blocks.push(`<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" /><figcaption>${escapeHtml(alt)}</figcaption></figure>`);
      }
      continue;
    }

    const quoteMatch = /^>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote><p>${renderInline(quoteMatch[1], sourceUrl)}</p></blockquote>`);
      continue;
    }

    const unorderedMatch = /^[-*]\s+(.+)$/.exec(line);
    if (unorderedMatch) {
      flushParagraph();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(`<li>${renderInline(unorderedMatch[1].trim(), sourceUrl)}</li>`);
      continue;
    }

    const orderedMatch = /^\d+[.)]\s+(.+)$/.exec(line);
    if (orderedMatch) {
      flushParagraph();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(`<li>${renderInline(orderedMatch[1].trim(), sourceUrl)}</li>`);
      continue;
    }

    if (/^(Author|Source|URL):\s+/i.test(line)) {
      continue;
    }

    paragraphBuffer.push(line);
  }

  if (codeFenceOpen) flushCode();
  flushParagraph();
  flushList();
  return blocks.join('\n');
}

function renderInline(text: string, sourceUrl: string): string {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let out = '';
  let cursor = 0;

  for (const match of text.matchAll(linkRegex)) {
    const idx = match.index ?? 0;
    out += escapeWithSafeInlineTags(text.slice(cursor, idx));
    const href = safeUrl(match[2].trim(), sourceUrl);
    if (href) {
      out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[1])}</a>`;
    } else {
      out += escapeHtml(match[1]);
    }
    cursor = idx + match[0].length;
  }

  out += escapeWithSafeInlineTags(text.slice(cursor));
  return out;
}

function escapeWithSafeInlineTags(input: string): string {
  if (!input) return '';
  let escaped = escapeHtml(input);
  escaped = escaped.replace(
    /&lt;(\/?)(em|strong|b|i|u|mark|code|sub|sup|s|del|ins|abbr)\s*&gt;/gi,
    (_match, slash: string, tag: string) => `<${slash}${tag.toLowerCase()}>`,
  );
  return escaped;
}

function safeUrl(input: string, baseUrl: string): string | null {
  try {
    const resolved = baseUrl ? new URL(input, baseUrl) : new URL(input);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

function normalizeContent(content: string, title: string): string {
  let normalized = normalizeMojibake(content);
  normalized = stripLeadingMeta(normalized, title);
  normalized = stripTrailingDetritus(normalized, title);
  return normalized;
}

function normalizeMojibake(input: string): string {
  return input
    .replaceAll('Ã¢â‚¬Â¢', '•')
    .replaceAll('Ã¢â‚¬"', '—')
    .replaceAll('Ã¢â‚¬â„¢', '’')
    .replaceAll('Ã¢â‚¬Å“', '“')
    .replaceAll('Ã¢â‚¬Â', '”')
    .replaceAll('Ã¢â‚¬Â¦', '…');
}

function stripLeadingMeta(text: string, title: string): string {
  const lines = text.split('\n');
  const titleNorm = normText(title);
  const toDrop = new Set<number>();
  let nonEmptySeen = 0;

  for (let i = 0; i < lines.length && nonEmptySeen < 10; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    nonEmptySeen++;

    if (trimmed.startsWith('#')) {
      const heading = trimmed.replace(/^#+\s*/, '');
      if (normText(heading) === titleNorm) {
        toDrop.add(i);
        continue;
      }
    }

    if (isMetaLine(trimmed) || isTagLine(trimmed)) {
      toDrop.add(i);
      continue;
    }

    if (!trimmed.startsWith('#') && trimmed.length > 80) break;
  }

  return lines.filter((_, i) => !toDrop.has(i)).join('\n').replace(/^\n+/, '');
}

function stripTrailingDetritus(content: string, title: string): string {
  const lines = content.split('\n');
  const titleWords = new Set(title.toLowerCase().split(/\s+/).filter(word => word.length > 3));

  const imageRefPattern = /^(?:\[Image:\s*([^\]]*)\]\(.*\)|!\[([^\]]*)\]\(.*\))$/;
  let trailingStart = -1;
  let consecutiveUnrelated = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    const match = trimmed.match(imageRefPattern);
    if (!match) {
      if (trimmed === '--- Article Images ---' && consecutiveUnrelated >= 3) {
        trailingStart = i;
      }
      break;
    }

    const alt = (match[1] || match[2] || '').trim().toLowerCase();
    const words = alt.split(/\s+/).filter(word => word.length > 3);
    if (words.length >= 3) {
      const overlap = words.filter(word => titleWords.has(word)).length;
      if (overlap === 0) {
        consecutiveUnrelated++;
        trailingStart = i;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  if (consecutiveUnrelated >= 3 && trailingStart !== -1) {
    return lines.slice(0, trailingStart).join('\n').trimEnd();
  }

  return content;
}

function normText(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^[^\w]+|[^\w]+$/g, '');
}

function isTagLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 50) return false;
  if (t.startsWith('#')) return false;
  if (/[.!?]$/.test(t)) return false;
  return /^[A-Z][A-Z0-9\s\-&]{1,48}$/.test(t) && /[A-Z].*[A-Z]/.test(t);
}

function isMetaLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
  if (/^\d+\s*min(?:ute)?s?\s*read/i.test(t)) return true;
  if (t.length < 80 && /[•|—–·]/.test(t) && /\d/.test(t)) return true;
  if (t.length < 60 && /[•|—–·]/.test(t) && !/[.!?]$/.test(t)) return true;
  if (/^(?:Timestamp|Source|Published|Updated|Date|Section|Category|Type)\s*:/i.test(t)) return true;
  return false;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
