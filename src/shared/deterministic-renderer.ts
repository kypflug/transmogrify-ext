interface DeterministicRenderInput {
  title: string;
  sourceUrl: string;
  content: string;
}

export function renderDeterministicHtml(input: DeterministicRenderInput): string {
  const contentHtml = structuredTextToHtml(input.content, input.title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f8f8f6;
      --surface: #ffffff;
      --text: #1d1d1b;
      --muted: #60605d;
      --rule: #d7d6d2;
      --accent: #2a6d9e;
      --max: 760px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #141413;
        --surface: #1d1d1b;
        --text: #f2f1ee;
        --muted: #b9b7b1;
        --rule: #3a3936;
        --accent: #86b7df;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.65;
    }
    main {
      max-width: var(--max);
      margin: 0 auto;
      padding: 2.5rem 1.1rem 4rem;
    }
    article {
      background: var(--surface);
      border: 1px solid var(--rule);
      border-radius: 14px;
      padding: 1.6rem 1.3rem;
    }
    h1 { margin: 0 0 0.7rem; line-height: 1.18; font-size: clamp(1.8rem, 5.2vw, 2.7rem); }
    .meta { margin: 0 0 1.2rem; color: var(--muted); font-size: 0.94rem; }
    .content h2, .content h3, .content h4, .content h5, .content h6 { margin: 1.6rem 0 0.65rem; line-height: 1.25; }
    .content p, .content ul, .content ol, .content blockquote, .content figure, .content pre { margin: 0.85rem 0; }
    .content a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
    .content blockquote { border-left: 3px solid var(--rule); padding: 0.2rem 0 0.2rem 0.8rem; color: var(--muted); font-style: italic; }
    .content img { width: 100%; max-width: 100%; height: auto; border-radius: 10px; display: block; }
    .content figcaption { margin-top: 0.35rem; color: var(--muted); font-size: 0.88rem; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${escapeHtml(input.title || 'Untitled')}</h1>
      <p class="meta">${escapeHtml(input.sourceUrl)}</p>
      <section class="content">${contentHtml}</section>
    </article>
  </main>
</body>
</html>`;
}

function structuredTextToHtml(content: string, title: string): string {
  const lines = content.split(/\r?\n/);
  const blocks: string[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').trim();
    if (text) blocks.push(`<p>${renderInline(text)}</p>`);
    paragraphBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

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

  flushParagraph();
  return blocks.join('\n');
}

function renderInline(text: string): string {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let out = '';
  let cursor = 0;

  for (const match of text.matchAll(linkRegex)) {
    const idx = match.index ?? 0;
    out += escapeHtml(text.slice(cursor, idx));
    out += `<a href="${escapeHtml(match[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[1])}</a>`;
    cursor = idx + match[0].length;
  }

  out += escapeHtml(text.slice(cursor));
  return out;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
