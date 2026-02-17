import { FAST_DETERMINISTIC_TEMPLATE } from '@kypflug/transmogrifier-core';

interface DeterministicRenderInput {
  title: string;
  sourceUrl: string;
  content: string;
}

export function renderDeterministicHtml(input: DeterministicRenderInput): string {
  const contentHtml = structuredTextToHtml(input.content, input.title);
  const title = input.title || 'Untitled';
  const meta = input.sourceUrl || '';

  return FAST_DETERMINISTIC_TEMPLATE
    .replaceAll('{TITLE}', escapeHtml(title))
    .replace('{META}', escapeHtml(meta))
    .replace('{EXCERPT}', '')
    .replace('{CONTENT}', contentHtml);
}

function structuredTextToHtml(content: string, title: string): string {
  const lines = content.split(/\r?\n/);
  const blocks: string[] = [];
  let paragraphBuffer: string[] = [];
  let codeFenceOpen = false;
  let codeBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').trim();
    if (text) blocks.push(`<p>${renderInline(text)}</p>`);
    paragraphBuffer = [];
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
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      const headingText = headingMatch[2].trim();
      if (headingText !== title) {
        const level = Math.min(6, headingMatch[1].length + 1);
        blocks.push(`<h${level}>${renderInline(headingText)}</h${level}>`);
      }
      continue;
    }

    const imageMatch = /^\[Image:\s*(.*?)\]\((https?:\/\/[^\s)]+)\)$/i.exec(line);
    if (imageMatch) {
      flushParagraph();
      const alt = imageMatch[1].trim() || 'Article image';
      blocks.push(`<figure><img src="${escapeHtml(imageMatch[2])}" alt="${escapeHtml(alt)}" loading="lazy" /><figcaption>${escapeHtml(alt)}</figcaption></figure>`);
      continue;
    }

    if (/^(Author|Source|URL):\s+/i.test(line)) {
      continue;
    }

    paragraphBuffer.push(line);
  }

  if (codeFenceOpen) flushCode();
  flushParagraph();
  return blocks.join('\n');
}

function renderInline(text: string): string {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let out = '';
  let cursor = 0;

  for (const match of text.matchAll(linkRegex)) {
    const idx = match.index ?? 0;
    out += escapeWithSafeInlineTags(text.slice(cursor, idx));
    out += `<a href="${escapeHtml(match[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[1])}</a>`;
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

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
