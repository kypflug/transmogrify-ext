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

const ICON_PROMPT = `Design a modern, playful browser extension icon inspired by the "Transmogrifier" from Calvin and Hobbes — an upside-down cardboard box with a large arrow pointing down on its side.

The icon should:
- Depict a simple upside-down cardboard box with a bold downward arrow
- Use warm cardboard brown tones with a purple/violet arrow (#667eea to #764ba2)
- Add subtle sparkles or magic particles around the box to suggest transformation
- Work at very small sizes (16x16 pixels) — keep shapes bold and minimal
- Have clean edges and high contrast
- Look playful yet professional
- NO text or letters
- Simple enough to be recognizable as a tiny favicon

Style: Flat design, minimal, modern app icon aesthetic with a whimsical touch.
Background: Transparent.`;

async function generateIcon(): Promise<void> {
  console.log('Ã°Å¸Å½Â¨ Generating Transmogrify icon...\n');
  console.log('Endpoint:', IMAGE_ENDPOINT);
  console.log('Deployment:', IMAGE_DEPLOYMENT);
  
  if (!IMAGE_ENDPOINT || !IMAGE_API_KEY) {
    console.error('Ã¢ÂÅ’ Image API not configured. Check your .env file.');
    process.exit(1);
  }

  const url = `${IMAGE_ENDPOINT}openai/deployments/${IMAGE_DEPLOYMENT}/images/generations?api-version=${IMAGE_API_VERSION}`;
  
  console.log('\nÃ°Å¸â€œÂ¤ Sending request to:', url);
  console.log('\nÃ°Å¸â€œÂ Prompt:', ICON_PROMPT.substring(0, 200) + '...\n');

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
      console.error('Ã¢ÂÅ’ API Error:', response.status, errorText);
      process.exit(1);
    }

    const result = await response.json();
    console.log('Ã¢Å“â€¦ Image generated successfully!\n');

    // Get the image data
    let imageData: Buffer;
    
    if (result.data?.[0]?.b64_json) {
      // Base64 response
      imageData = Buffer.from(result.data[0].b64_json, 'base64');
      console.log('Ã°Å¸â€œÂ¦ Received base64 image data');
    } else if (result.data?.[0]?.url) {
      // URL response - download the image
      console.log('Ã°Å¸â€â€” Downloading from URL:', result.data[0].url.substring(0, 80) + '...');
      imageData = await downloadImage(result.data[0].url);
    } else {
      console.error('Ã¢ÂÅ’ Unexpected response format:', JSON.stringify(result, null, 2));
      process.exit(1);
    }

    // Save the full-size icon
    const outputDir = path.join(process.cwd(), 'public', 'icons');
    const fullSizePath = path.join(outputDir, 'transmogrify-generated.png');
    
    fs.writeFileSync(fullSizePath, imageData);
    console.log(`\nÃ°Å¸â€™Â¾ Saved full-size icon to: ${fullSizePath}`);
    
    console.log('\nÃ¢Å¡Â Ã¯Â¸Â  Note: You\'ll need to manually resize the icon to:');
    console.log('   - transmogrify16.png (16x16)');
    console.log('   - transmogrify48.png (48x48)');
    console.log('   - transmogrify128.png (128x128)');
    console.log('\n   Use an image editor or online tool to resize and optimize.');
    console.log('   The generated icon is at: public/icons/transmogrify-generated.png');

  } catch (error) {
    console.error('Ã¢ÂÅ’ Error:', error);
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
