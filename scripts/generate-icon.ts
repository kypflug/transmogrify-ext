/**
 * Icon Generator Script
 * Generates extension icons using Azure OpenAI gpt-image-1.5
 * 
 * Run with: npx ts-node --esm scripts/generate-icon.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// Load from .env manually since we're running as a script
const envContent = fs.readFileSync('.env', 'utf-8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    env[key.trim()] = valueParts.join('=').trim();
  }
});

const IMAGE_ENDPOINT = env.VITE_AZURE_IMAGE_ENDPOINT;
const IMAGE_API_KEY = env.VITE_AZURE_IMAGE_API_KEY;
const IMAGE_DEPLOYMENT = env.VITE_AZURE_IMAGE_DEPLOYMENT || 'gpt-image-1.5';
const IMAGE_API_VERSION = env.VITE_AZURE_IMAGE_API_VERSION || '2024-10-21';

const ICON_PROMPT = `Design a modern, minimal browser extension icon for "Focus Remix" - a tool that transforms cluttered web pages into beautiful, focused reading experiences.

The icon should:
- Be a simple, bold symbol that works at very small sizes (16x16 pixels)
- Use a purple/violet gradient (#667eea to #764ba2) as the primary color
- Convey the concept of "transformation" or "remix" - perhaps:
  - A stylized page being transformed
  - An abstract "focus" or "zen" symbol
  - A magic wand or sparkle effect
  - Overlapping/morphing shapes
- Have clean edges and high contrast
- Look professional and modern
- NO text or letters
- Simple enough to be recognizable as a tiny favicon

Style: Flat design, minimal, modern app icon aesthetic. Think iOS/Android app icon simplicity.
Background: Transparent or solid color that contrasts well.`;

async function generateIcon(): Promise<void> {
  console.log('🎨 Generating Focus Remix icon...\n');
  console.log('Endpoint:', IMAGE_ENDPOINT);
  console.log('Deployment:', IMAGE_DEPLOYMENT);
  
  if (!IMAGE_ENDPOINT || !IMAGE_API_KEY) {
    console.error('❌ Image API not configured. Check your .env file.');
    process.exit(1);
  }

  const url = `${IMAGE_ENDPOINT}openai/deployments/${IMAGE_DEPLOYMENT}/images/generations?api-version=${IMAGE_API_VERSION}`;
  
  console.log('\n📤 Sending request to:', url);
  console.log('\n📝 Prompt:', ICON_PROMPT.substring(0, 200) + '...\n');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': IMAGE_API_KEY,
      },
      body: JSON.stringify({
        prompt: ICON_PROMPT,
        n: 1,
        size: '1024x1024', // Generate large, then we'll resize
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error:', response.status, errorText);
      process.exit(1);
    }

    const result = await response.json();
    console.log('✅ Image generated successfully!\n');

    // Get the image data
    let imageData: Buffer;
    
    if (result.data?.[0]?.b64_json) {
      // Base64 response
      imageData = Buffer.from(result.data[0].b64_json, 'base64');
      console.log('📦 Received base64 image data');
    } else if (result.data?.[0]?.url) {
      // URL response - download the image
      console.log('🔗 Downloading from URL:', result.data[0].url.substring(0, 80) + '...');
      imageData = await downloadImage(result.data[0].url);
    } else {
      console.error('❌ Unexpected response format:', JSON.stringify(result, null, 2));
      process.exit(1);
    }

    // Save the full-size icon
    const outputDir = path.join(process.cwd(), 'public', 'icons');
    const fullSizePath = path.join(outputDir, 'icon-generated.png');
    
    fs.writeFileSync(fullSizePath, imageData);
    console.log(`\n💾 Saved full-size icon to: ${fullSizePath}`);
    
    console.log('\n⚠️  Note: You\'ll need to manually resize the icon to:');
    console.log('   - icon16.png (16x16)');
    console.log('   - icon48.png (48x48)');
    console.log('   - icon128.png (128x128)');
    console.log('\n   Use an image editor or online tool to resize and optimize.');
    console.log('   The generated icon is at: public/icons/icon-generated.png');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

function downloadImage(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : require('http');
    
    protocol.get(url, (response: any) => {
      const chunks: Buffer[] = [];
      
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Run the script
generateIcon();
