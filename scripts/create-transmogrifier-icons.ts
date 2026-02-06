/**
 * Create Transmogrifier Icons
 * Generates extension icons depicting the iconic upside-down cardboard box
 * with a pointing arrow — the "Transmogrifier" from Calvin and Hobbes.
 *
 * Run with: npx tsx scripts/create-transmogrifier-icons.ts
 */

import sharp from 'sharp';
import * as path from 'path';

const SIZES = [16, 48, 128];
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'icons');

/**
 * Generate an SVG of the Transmogrifier box at a given size.
 * The design: an upside-down cardboard box with a big arrow pointing down,
 * rendered in a warm, playful style with clean vector lines.
 */
function generateTransmogrifierSVG(size: number): string {
  // All coordinates are in a 128x128 viewBox, scaled by sharp
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">
  <defs>
    <!-- Cardboard gradient -->
    <linearGradient id="box" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#D4915C"/>
      <stop offset="100%" stop-color="#B87333"/>
    </linearGradient>
    <!-- Darker side panel -->
    <linearGradient id="boxSide" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#A0622A"/>
      <stop offset="100%" stop-color="#8B5423"/>
    </linearGradient>
    <!-- Arrow gradient (purple/violet like the extension brand) -->
    <linearGradient id="arrow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#667eea"/>
      <stop offset="100%" stop-color="#764ba2"/>
    </linearGradient>
    <!-- Sparkle/magic glow -->
    <radialGradient id="glow" cx="50%" cy="70%" r="45%">
      <stop offset="0%" stop-color="#667eea" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#667eea" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background glow -->
  <circle cx="64" cy="72" r="56" fill="url(#glow)"/>

  <!-- Box body (upside-down trapezoid) -->
  <path d="M24,38 L104,38 L96,100 L32,100 Z" fill="url(#box)" stroke="#7A4A1E" stroke-width="2.5"/>

  <!-- Box flaps (top edge, upside down so they're at the bottom) -->
  <!-- Left flap -->
  <path d="M32,100 L24,112 L48,100 Z" fill="#C4813E" stroke="#7A4A1E" stroke-width="2"/>
  <!-- Right flap -->
  <path d="M80,100 L104,112 L96,100 Z" fill="#C4813E" stroke="#7A4A1E" stroke-width="2"/>
  <!-- Center flap -->
  <path d="M48,100 L52,110 L76,110 L80,100 Z" fill="#D4915C" stroke="#7A4A1E" stroke-width="2"/>

  <!-- Tape/seam line on box -->
  <line x1="64" y1="38" x2="64" y2="100" stroke="#7A4A1E" stroke-width="1.5" stroke-dasharray="6,4"/>

  <!-- DOWN ARROW on the box face -->
  <g transform="translate(64,66)">
    <!-- Arrow shaft -->
    <rect x="-8" y="-22" width="16" height="28" rx="2" fill="url(#arrow)"/>
    <!-- Arrow head -->
    <polygon points="-18,6 0,24 18,6" fill="url(#arrow)"/>
  </g>

  <!-- Label text "TRANSMOGRIFIER" (tiny, on the box) -->
  <text x="64" y="48" text-anchor="middle" font-family="Arial Black, Arial, sans-serif"
        font-size="7" font-weight="900" fill="#5C3310" letter-spacing="0.5" opacity="0.7">
    TRANSMOGRIFIER
  </text>

  <!-- Sparkles around the box -->
  <g fill="#667eea" opacity="0.8">
    <!-- Star top-left -->
    <polygon points="18,28 20,22 22,28 20,30" />
    <!-- Star top-right -->
    <polygon points="106,28 108,22 110,28 108,30" />
    <!-- Star bottom -->
    <polygon points="52,116 54,112 56,116 54,118" />
    <!-- Small dots -->
    <circle cx="14" cy="50" r="2"/>
    <circle cx="114" cy="52" r="2"/>
    <circle cx="40" cy="22" r="1.5"/>
    <circle cx="88" cy="20" r="1.5"/>
  </g>
</svg>`;
}

async function createIcons(): Promise<void> {
  console.log('📦 Creating Transmogrifier icons...\n');

  for (const size of SIZES) {
    const svg = generateTransmogrifierSVG(size);
    const outputFile = path.join(OUTPUT_DIR, `transmogrify${size}.png`);

    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png({ quality: 100, compressionLevel: 9 })
      .toFile(outputFile);

    console.log(`✅ Created transmogrify${size}.png (${size}x${size})`);
  }

  // Also create a large version for the generate-icon reference
  const largeSvg = generateTransmogrifierSVG(512);
  const largeFile = path.join(OUTPUT_DIR, 'transmogrify-full.png');
  await sharp(Buffer.from(largeSvg))
    .resize(512, 512)
    .png({ quality: 100 })
    .toFile(largeFile);
  console.log(`✅ Created transmogrify-full.png (512x512)`);

  console.log('\n🎉 All Transmogrifier icons created!');
  console.log('   Icons are in public/icons/');
}

createIcons().catch(console.error);
