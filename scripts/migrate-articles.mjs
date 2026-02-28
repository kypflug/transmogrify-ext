#!/usr/bin/env node
/**
 * Migration script: inject dates and fix duplicate images in existing articles.
 *
 * Usage:
 *   node scripts/migrate-articles.mjs [--dry-run]
 *
 * What it does:
 *   1. Reads each *.html file in the articles folder
 *   2. Extracts retrieval date from the article ID timestamp in the filename
 *   3. Attempts to fetch publication date from the source URL's og metadata
 *   4. Injects both dates into the .meta / header element
 *   5. Removes consecutive duplicate <figure>/<img> elements with the same base URL
 *   6. Writes updated HTML back to disk
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ARTICLES_DIR = String.raw`C:\Users\KyleP\OneDrive\Apps\Transmogrifier Sync\articles`;
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Date Helpers ────────────────────────────────────────────────────────────

function formatDate(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function extractTimestampFromFilename(filename) {
  const match = filename.match(/article_(\d+)_/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

// ─── OG Metadata Fetching ────────────────────────────────────────────────────

async function fetchPublishDate(url) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    // Only read the first chunk (head section)
    const text = await res.text();
    const head = text.slice(0, 15000);

    // Try article:published_time
    let match = head.match(/<meta\s+property="article:published_time"\s+content="([^"]+)"/i);
    if (match) return match[1];

    // Try <time datetime>
    match = head.match(/<time[^>]+datetime="([^"]+)"/i);
    if (match) return match[1];

    // Try datePublished in LD+JSON
    match = head.match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (match) return match[1];

    return null;
  } catch {
    return null;
  }
}

// ─── HTML Processing ─────────────────────────────────────────────────────────

function injectDates(html, retrievedDate, publishDate) {
  // Check if dates already injected
  if (html.includes('Retrieved ') && html.includes('class="article-dates"')) return html;

  // Format dates
  const retrievedStr = retrievedDate ? `Retrieved ${formatDate(retrievedDate)}` : null;
  let publishStr = null;
  if (publishDate) {
    try {
      const d = new Date(publishDate);
      if (!isNaN(d.getTime())) publishStr = formatDate(d);
    } catch { /* skip */ }
  }

  const dateParts = [publishStr, retrievedStr].filter(Boolean);
  if (dateParts.length === 0) return html;
  const dateStr = dateParts.join(' · ');

  // Strategy 1: Inject into <p class="meta"> (Fast recipe / deterministic template)
  const metaMatch = html.match(/(<p\s+class="meta">)(.*?)(<\/p>)/is);
  if (metaMatch) {
    const [fullMatch, openTag, content, closeTag] = metaMatch;
    if (content.includes('Retrieved ')) return html;

    // Insert before " · <a" (Source link) or at end
    const sourceLink = content.match(/(\s*·\s*<a\s)/i);
    if (sourceLink) {
      const insertPos = content.indexOf(sourceLink[0]);
      const newContent = content.slice(0, insertPos) + ' · ' + dateStr + sourceLink[0] + content.slice(insertPos + sourceLink[0].length);
      return html.replace(fullMatch, openTag + newContent + closeTag);
    } else {
      return html.replace(fullMatch, openTag + content + ' · ' + dateStr + closeTag);
    }
  }

  // Strategy 2: Inject into byline/meta div that contains a Source link
  const metaDivMatch = html.match(/(<(?:div|p|span)\s+class="[^"]*(?:byline|meta)[^"]*">)([\s\S]*?)(<\/(?:div|p|span)>)/i);
  if (metaDivMatch) {
    const [fullMatch, openTag, content, closeTag] = metaDivMatch;
    if (content.includes('Retrieved ')) return html;
    const sourceLink = content.match(/(\s*·?\s*<a\s[^>]*>Source[^<]*<\/a>)/i);
    if (sourceLink) {
      const insertPos = content.indexOf(sourceLink[0]);
      const newContent = content.slice(0, insertPos) + ' · ' + dateStr + sourceLink[0] + content.slice(insertPos + sourceLink[0].length);
      return html.replace(fullMatch, openTag + newContent + closeTag);
    }
  }

  // Strategy 3: For AI-generated articles, insert a date line after </header>
  const headerClose = html.indexOf('</header>');
  if (headerClose !== -1) {
    if (html.includes('class="article-dates"')) return html;
    const insertPos = headerClose + '</header>'.length;
    const dateLine = `\n      <p class="article-dates" style="color:var(--muted,#888);font-size:0.82rem;font-family:system-ui,sans-serif;margin:0.4rem 0 0.8rem;opacity:0.7">${dateStr}</p>`;
    return html.slice(0, insertPos) + dateLine + html.slice(insertPos);
  }

  return html;
}

function deduplicateImages(html) {
  // Find consecutive <figure> elements with <img> tags sharing the same base URL
  // Pattern: <figure...><img src="URL"...>...</figure>
  const figurePattern = /(<figure[^>]*>[\s\S]*?<\/figure>)\s*/gi;
  const figures = [...html.matchAll(figurePattern)];

  if (figures.length < 2) return html;

  const toRemove = new Set();

  for (let i = 0; i < figures.length - 1; i++) {
    if (toRemove.has(i)) continue;

    const srcA = extractImgSrc(figures[i][1]);
    if (!srcA) continue;
    const baseA = getBasePath(srcA);

    // Check consecutive figures
    for (let j = i + 1; j < figures.length; j++) {
      // Check if they are actually consecutive in the HTML
      const gapStart = figures[i].index + figures[i][0].length;
      const gapEnd = figures[j].index;
      const gap = html.slice(gapStart, gapEnd).trim();
      if (gap.length > 0) break; // Not consecutive

      const srcB = extractImgSrc(figures[j][1]);
      if (!srcB) break;
      const baseB = getBasePath(srcB);

      if (baseA === baseB) {
        // Keep the one with larger dimensions
        const sizeA = getImageSize(srcA);
        const sizeB = getImageSize(srcB);
        if (sizeB.w * sizeB.h > sizeA.w * sizeA.h) {
          toRemove.add(i);
        } else {
          toRemove.add(j);
        }
      }
    }
  }

  if (toRemove.size === 0) return html;

  // Remove the duplicate figures (process from end to start to preserve indices)
  let result = html;
  const sortedIndices = [...toRemove].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    const fig = figures[idx];
    result = result.slice(0, fig.index) + result.slice(fig.index + fig[0].length);
  }

  return result;
}

function extractImgSrc(figureHtml) {
  const match = figureHtml.match(/<img\s[^>]*src="([^"]+)"/i);
  return match ? decodeHtmlEntities(match[1]) : null;
}

function decodeHtmlEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

function getBasePath(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

function getImageSize(url) {
  try {
    const params = new URL(url).searchParams;
    const w = parseInt(params.get('w') || params.get('width') || '0', 10) || 0;
    const h = parseInt(params.get('h') || params.get('height') || '0', 10) || 0;
    return { w, h };
  } catch {
    return { w: 0, h: 0 };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const files = readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.html'));
  console.log(`Found ${files.length} article HTML files`);
  if (DRY_RUN) console.log('DRY RUN — no files will be modified\n');

  let dateInjected = 0;
  let imagesFixed = 0;
  let unchanged = 0;
  let errors = 0;

  for (const file of files) {
    const htmlPath = join(ARTICLES_DIR, file);
    const jsonPath = join(ARTICLES_DIR, file.replace('.html', '.json'));

    try {
      let html = readFileSync(htmlPath, 'utf-8');
      const originalHtml = html;

      // 1. Extract retrieval date from filename
      const ts = extractTimestampFromFilename(file);
      const retrievedDate = ts ? new Date(ts) : null;

      // 2. Get source URL from JSON metadata
      let sourceUrl = null;
      if (existsSync(jsonPath)) {
        try {
          const meta = JSON.parse(readFileSync(jsonPath, 'utf-8'));
          sourceUrl = meta.originalUrl;
        } catch { /* skip */ }
      }

      // 3. Fetch publication date from source (with rate limiting)
      let publishDate = null;
      if (sourceUrl) {
        publishDate = await fetchPublishDate(sourceUrl);
        // Brief delay to be polite
        await new Promise(r => setTimeout(r, 200));
      }

      // 4. Inject dates
      html = injectDates(html, retrievedDate, publishDate);

      // 5. Fix duplicate images
      html = deduplicateImages(html);

      // 6. Write if changed
      if (html !== originalHtml) {
        const dateChanged = html !== deduplicateImages(originalHtml);
        const imageChanged = deduplicateImages(originalHtml) !== originalHtml;

        if (dateChanged) dateInjected++;
        if (imageChanged) imagesFixed++;

        if (!DRY_RUN) {
          writeFileSync(htmlPath, html, 'utf-8');
        }
        console.log(`✓ ${file}${publishDate ? ` (pub: ${publishDate})` : ''} ${dateChanged ? '[dates]' : ''} ${imageChanged ? '[images]' : ''}`);
      } else {
        unchanged++;
      }
    } catch (err) {
      console.error(`✗ ${file}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone! ${dateInjected} dates injected, ${imagesFixed} image dupes fixed, ${unchanged} unchanged, ${errors} errors`);
}

main().catch(console.error);
