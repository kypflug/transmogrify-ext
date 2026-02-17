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

    const parsedImage = parseImageLine(line, sourceUrl);
    if (parsedImage) {
      flushParagraph();
      flushList();
      const caption = parsedImage.caption || parsedImage.alt;
      blocks.push(`<figure><img src="${escapeHtml(parsedImage.src)}" alt="${escapeHtml(parsedImage.alt)}" loading="lazy" /><figcaption>${escapeHtml(caption)}</figcaption></figure>`);
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
  normalized = stripUiDetritusLines(normalized);
  normalized = collapseDuplicateLines(normalized);
  normalized = stripTrailingDetritus(normalized, title);
  return normalized;
}

function parseImageLine(line: string, sourceUrl: string): { alt: string; src: string; caption?: string } | null {
  const parsed = parseImageReference(line);
  if (!parsed) return null;
  const src = safeUrl(parsed.rawUrl.trim(), sourceUrl);
  if (!src) return null;

  const alt = parsed.alt.trim() || 'Article image';
  const caption = normalizeTrailingCaption(parsed.trailing);
  return { alt, src, caption: caption || undefined };
}

function parseImageReference(line: string): { alt: string; rawUrl: string; trailing: string } | null {
  const imagePrefix = /^!\[([^\]]*)\]\(/.exec(line);
  const bracketPrefix = /^\[Image:\s*([^\]]*)\]\(/i.exec(line);
  const prefix = imagePrefix || bracketPrefix;
  if (!prefix) return null;

  const alt = prefix[1] || '';
  const start = prefix[0].length;
  let depth = 1;
  let i = start;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }

  if (depth !== 0) return null;
  const rawUrl = line.slice(start, i).trim();
  const trailing = line.slice(i + 1).trim();
  if (!rawUrl) return null;
  return { alt, rawUrl, trailing };
}

function normalizeTrailingCaption(input: string): string {
  if (!input) return '';
  let text = input.trim();
  text = text.replace(/^[\-:–—\s]+/, '').trim();
  text = text.replace(/^([*_])(.*)\1$/, '$2').trim();
  return text;
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
  let trailingStart = -1;
  let consecutiveUnrelated = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    const parsed = parseImageReference(trimmed);
    if (!parsed) {
      if (trimmed === '--- Article Images ---' && consecutiveUnrelated >= 3) {
        trailingStart = i;
      }
      break;
    }

    const alt = parsed.alt.trim().toLowerCase();
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

function stripUiDetritusLines(content: string): string {
  return content
    .split('\n')
    .filter(line => !isUiDetritusLine(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function isUiDetritusLine(line: string): boolean {
  if (!line) return false;
  const t = line.trim();
  if (t.length > 220) return false;

  if (/^Follow topics and authors from this story/i.test(t)) return true;
  if (/^Thanks for reading .*Subscribe/i.test(t)) return true;
  if (/^By subscribing, you agree/i.test(t)) return true;
  if (/^\s*[•\-*]\s*[^\n]*\b(?:follow|see all)\b/i.test(t) && /\bclose\b/i.test(t)) return true;

  if (/posts from this (?:topic|author) will be added to your daily email digest/i.test(t)) return true;
  if (/daily email digest and your homepage feed/i.test(t)) return true;
  if (/\bfollowfollow\b/i.test(t)) return true;
  if (/\bsee all\b/i.test(t) && /\bfollow\b/i.test(t)) return true;
  if (/\blink\b\s*[•|]\s*\bshare\b\s*[•|]\s*\bgift\b/i.test(t)) return true;
  if (/\b[a-z][a-z\s&.-]{2,30}close[a-z][a-z\s&.-]{2,40}posts from this (?:topic|author)\b/i.test(t)) return true;

  return false;
}

function collapseDuplicateLines(content: string): string {
  const lines = content.split('\n');
  const deduped: string[] = [];
  let prevNorm = '';

  for (const line of lines) {
    const norm = line.trim().toLowerCase().replace(/\s+/g, ' ');
    if (norm && norm === prevNorm && (norm.length > 24 || norm.startsWith('#'))) {
      continue;
    }
    deduped.push(line);
    if (norm) prevNorm = norm;
  }

  return deduped.join('\n');
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
