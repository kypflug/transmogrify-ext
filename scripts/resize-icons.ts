/**
 * Resize Icon Script
 * Crops negative space and resizes the generated icon to required Chrome extension sizes
 * 
 * Run with: npx tsx scripts/resize-icons.ts
 */

import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';

const SIZES = [16, 48, 128];
const INPUT_FILE = path.join(process.cwd(), 'public', 'icons', 'transmogrify-full.png');
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'icons');

async function resizeIcons(): Promise<void> {
  console.log('🔄 Processing icons...\n');
  
  if (!fs.existsSync(INPUT_FILE)) {
    console.error('❌ Input file not found:', INPUT_FILE);
    console.error('   Run generate-icon.ts first.');
    process.exit(1);
  }

  // First, trim the negative space and get the cropped image
  console.log('✂️  Trimming negative space...');
  const trimmed = await sharp(INPUT_FILE)
    .trim() // Removes transparent/same-color borders
    .toBuffer();
  
  const trimmedMeta = await sharp(trimmed).metadata();
  console.log(`   Original cropped to ${trimmedMeta.width}x${trimmedMeta.height}\n`);

  // Save the trimmed version
  const trimmedPath = path.join(OUTPUT_DIR, 'icon-trimmed.png');
  await sharp(trimmed).toFile(trimmedPath);
  console.log(`💾 Saved trimmed icon: icon-trimmed.png\n`);

  // Now resize from the trimmed image
  for (const size of SIZES) {
    const outputFile = path.join(OUTPUT_DIR, `transmogrify${size}.png`);
    
    // Add a small padding (10%) so the icon doesn't touch edges
    const padding = Math.round(size * 0.1);
    const innerSize = size - (padding * 2);
    
    await sharp(trimmed)
      .resize(innerSize, innerSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({
        quality: 100,
        compressionLevel: 9,
      })
      .toFile(outputFile);
    
    console.log(`✅ Created transmogrify${size}.png (${size}x${size})`);
  }

  console.log('\n🎉 All icons created successfully!');
  console.log('   The extension icons are ready in public/icons/');
}

resizeIcons().catch(console.error);
