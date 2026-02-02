/**
 * Recipe System v2
 * Generates complete HTML documents instead of DOM mutations
 */

export interface Recipe {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  icon: string;
  supportsImages?: boolean;
}

export interface ImagePlaceholder {
  id: string;
  prompt: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024';
  style?: 'natural' | 'vivid';
  altText: string;
  placement: 'hero' | 'inline' | 'background' | 'accent';
}

export interface AIResponse {
  /** Complete HTML document to render */
  html: string;
  /** Image placeholders for AI generation */
  images?: ImagePlaceholder[];
  /** Brief explanation of design choices */
  explanation?: string;
}

const SAVE_BUTTON_SCRIPT = `
<!-- Focus Remix Save Button -->
<style>
  .remix-save-fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    transition: all 0.2s ease;
    z-index: 99999;
  }
  .remix-save-fab:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
  }
  .remix-save-fab:active {
    transform: scale(0.95);
  }
  .remix-save-fab.saved {
    background: #4CAF50;
  }
  .remix-save-tooltip {
    position: absolute;
    right: 64px;
    background: #333;
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }
  .remix-save-fab:hover .remix-save-tooltip {
    opacity: 1;
  }
</style>
<button class="remix-save-fab" id="remixSaveFab" title="Save to file">
  <span class="remix-save-tooltip">Save to file</span>
  💾
</button>
<script>
  document.getElementById('remixSaveFab').addEventListener('click', function() {
    // Send message to parent (viewer page) to trigger export
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'FOCUS_REMIX_SAVE' }, '*');
      this.innerHTML = '✓';
      this.classList.add('saved');
      setTimeout(() => {
        this.innerHTML = '💾';
        this.classList.remove('saved');
      }, 2000);
    } else {
      // Fallback: download directly
      const html = document.documentElement.outerHTML;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'remixed-page.html';
      a.click();
      URL.revokeObjectURL(url);
    }
  });
</script>
`;

const RESPONSE_FORMAT = `
You MUST respond with a JSON object containing these fields:
{
  "html": "<!DOCTYPE html>...(complete HTML document)...",
  "explanation": "Brief explanation of your design choices"
}

HTML REQUIREMENTS:
- Output a COMPLETE, valid HTML5 document with <!DOCTYPE html>, <html>, <head>, and <body>
- Include all CSS inline in a <style> tag in <head>
- Use semantic HTML5 elements (article, section, header, main, figure, etc.)
- Make it fully responsive with mobile-first CSS
- Use modern CSS (flexbox, grid, custom properties, clamp())
- Include a viewport meta tag
- Preserve ALL content from the source - don't summarize or truncate
- Convert markdown-style links [text](url) to proper <a> tags
- For images, use the provided src URLs directly

CSS BEST PRACTICES:
- Use CSS custom properties for colors and spacing
- Use clamp() for fluid typography
- Mobile-first responsive design
- Smooth transitions where appropriate
- System font stack for performance
- Minimal layout shift
- For gradient backgrounds on body/html: ALWAYS include background-repeat: no-repeat; background-attachment: fixed; min-height: 100vh;

ACCESSIBILITY:
- Proper heading hierarchy
- Alt text for images
- Good color contrast
- Focus states for interactive elements

SAVE BUTTON: Include this exact HTML at the end of <body> for the save functionality:
${SAVE_BUTTON_SCRIPT}

CRITICAL: Output the full HTML as a single string in the "html" field. Escape quotes within the HTML using \\" and newlines using \\n.
`;

const RESPONSE_FORMAT_WITH_IMAGES = `
You MUST respond with a JSON object containing these fields:
{
  "html": "<!DOCTYPE html>...(complete HTML document)...",
  "images": [
    {
      "id": "unique-id",
      "prompt": "Detailed image generation prompt...",
      "size": "1536x1024",
      "style": "natural",
      "altText": "Accessible description",
      "placement": "hero"
    }
  ],
  "explanation": "Brief explanation of your design choices"
}

HTML REQUIREMENTS:
- Output a COMPLETE, valid HTML5 document
- Include all CSS inline in a <style> tag
- Use semantic HTML5 elements
- Make it fully responsive with mobile-first CSS
- Use modern CSS (flexbox, grid, custom properties, clamp())
- Preserve ALL content from the source
- For AI-generated images, use placeholder: <img src="{{IMAGE_ID}}" alt="...">
- For original images from the source, keep their original URLs

IMAGE PLACEHOLDERS:
- Use {{image-id}} syntax in img src for AI-generated images
- Match the "id" field in the images array
- placement options: "hero" (top banner), "inline" (within content), "background" (section bg), "accent" (decorative)
- Write detailed, evocative prompts for the AI image generator
- Include as many images as would genuinely enhance the content - the more helpful illustrations the better!
- For long articles, consider 5-10+ images at natural breakpoints

CSS BEST PRACTICES:
- Use CSS custom properties for colors and spacing  
- Use clamp() for fluid typography
- Mobile-first responsive design
- Include image loading states
- Optimize for Core Web Vitals
- For gradient backgrounds on body/html: ALWAYS include background-repeat: no-repeat; background-attachment: fixed; min-height: 100vh;

SAVE BUTTON: Include this exact HTML at the end of <body> for the save functionality:
${SAVE_BUTTON_SCRIPT}

CRITICAL: Output the full HTML as a single string in the "html" field. Escape quotes using \\" and newlines using \\n.
`;

export const BUILT_IN_RECIPES: Recipe[] = [
  {
    id: 'focus',
    name: 'Focus Mode',
    description: 'Clean, distraction-free reading',
    icon: '◎',
    supportsImages: false,
    systemPrompt: `You are an expert web designer creating a beautiful, focused reading experience.

Given content extracted from a webpage, generate a COMPLETE HTML document that:
- Presents the content in a clean, distraction-free layout
- Uses a centered, readable column width (max 65-70ch)
- Has generous whitespace and comfortable line-height (1.6-1.7)
- Uses a refined typographic scale
- Is fully responsive
- Loads fast with minimal CSS

Design style: Minimalist, calm, focused. Think Medium.com or iA Writer.
${RESPONSE_FORMAT}`,
    userPromptTemplate: `Transform this content into a beautiful, focused reading experience:

{CONTENT}

Create a complete HTML document optimized for distraction-free reading.`,
  },
  {
    id: 'reader',
    name: 'Reader Mode',
    description: 'Article-optimized typography',
    icon: '☰',
    supportsImages: false,
    systemPrompt: `You are a typography expert creating an optimal article reading experience.

Given content extracted from a webpage, generate a COMPLETE HTML document that:
- Uses excellent typography (proper font sizes, line-height, letter-spacing)
- Has a refined type scale based on a modular scale
- Includes proper styling for all content types (headings, quotes, code, lists, tables)
- Shows article metadata elegantly (author, date, reading time)
- Has a subtle, sophisticated color palette
- Includes a progress indicator or reading position marker

Design style: Editorial, refined, like a well-designed digital magazine.
${RESPONSE_FORMAT}`,
    userPromptTemplate: `Transform this content into a beautifully typeset article:

{CONTENT}

Create an HTML document with exceptional typography and reading experience.`,
  },
  {
    id: 'aesthetic',
    name: 'Aesthetic',
    description: 'Creative visual transformation',
    icon: '✨',
    supportsImages: true,
    systemPrompt: `You are a creative director creating STUNNING visual experiences from web content.

BE BOLD AND CREATIVE. This is about artistic transformation, not just cleaning up.

Given content extracted from a webpage, generate a COMPLETE HTML document that:
- Has a STRIKING visual identity - bold colors, interesting layouts, dramatic typography
- Uses creative CSS techniques: gradients, blend modes, clip-paths, transforms
- Features asymmetric or unconventional layouts where appropriate
- Includes subtle animations and micro-interactions (CSS only, no JS)
- Creates visual hierarchy through scale contrast and whitespace
- May use interesting grid arrangements, overlapping elements, or magazine-style layouts
- Incorporates AI-generated images as hero visuals or accent elements

Creative techniques to consider:
- Large, impactful hero sections with dramatic type
- Pull quotes with distinctive styling
- Gradient text or gradient overlays
- Interesting image treatments (duotone, borders, shapes)
- Creative use of whitespace
- Bold color blocking
- Asymmetric grids
- Floating accent elements

DON'T be boring. DON'T just center everything. CREATE something visually memorable.

Design style: Creative, bold, magazine-editorial meets modern web. Think award-winning portfolio sites.
${RESPONSE_FORMAT_WITH_IMAGES}`,
    userPromptTemplate: `Transform this content into a VISUALLY STUNNING creative experience:

{CONTENT}

Be bold! Create a dramatic, artistic presentation that makes this content visually memorable.
Use creative layouts, bold typography, interesting color choices, and AI-generated imagery.`,
  },
  {
    id: 'illustrated',
    name: 'Illustrated',
    description: 'Enhanced with AI imagery',
    icon: '🎨',
    supportsImages: true,
    systemPrompt: `You are a designer who enhances content with meaningful AI-generated images.

Given content extracted from a webpage, generate a COMPLETE HTML document that:
- Has a clean, professional layout
- Is thoughtfully illustrated with AI-generated images
- For technical content: diagrams, flowcharts, architectural illustrations
- For articles: evocative imagery that captures key themes
- For how-tos: step-by-step visual illustrations
- Places images strategically to break up text and add visual interest

IMAGE GUIDELINES:
- Aim for 5-10 images maximum, even for longer content
- Focus on quality over quantity - each image should add real value
- Prioritize: 1 hero image, then images for major sections
- Don't illustrate every paragraph - be selective

Write detailed image prompts that specify:
- Subject and composition
- Style (illustration, diagram, photo-realistic, watercolor, etc.)
- Color palette that matches the page design
- Mood and atmosphere
- Specific details that make the image relevant to that section

Design style: Clean and professional with thoughtfully placed illustrations.
${RESPONSE_FORMAT_WITH_IMAGES}`,
    userPromptTemplate: `Transform this content with meaningful AI-generated illustrations:

{CONTENT}

Create an HTML document with 5-10 strategically placed AI-generated images that enhance the content. Focus on quality - each image should add real value.`,
  },
  {
    id: 'visualize',
    name: 'Visualize',
    description: 'Diagrams and infographics',
    icon: '📊',
    supportsImages: true,
    systemPrompt: `You are an information designer who transforms content into visual explanations.

Given content extracted from a webpage, generate a COMPLETE HTML document that:
- Presents information visually wherever possible
- Uses AI-generated diagrams for processes and relationships
- Creates infographic-style layouts for data
- Uses visual hierarchy to guide understanding
- Balances visuals with readable text

For image prompts, create:
- Flowcharts and process diagrams
- Concept maps and relationship diagrams
- Data visualizations and infographics
- Architectural or system diagrams
- Step-by-step illustrated guides

Be specific in prompts: describe the diagram structure, labels, colors, and style.

Design style: Informational, clear, educational. Think textbook meets modern infographic.
${RESPONSE_FORMAT_WITH_IMAGES}`,
    userPromptTemplate: `Transform this content into a visual, diagram-rich explanation:

{CONTENT}

Create an HTML document that visualizes concepts with diagrams and infographics.`,
  },
  {
    id: 'declutter',
    name: 'Clean',
    description: 'Simple and fast',
    icon: '🧹',
    supportsImages: false,
    systemPrompt: `You are a performance-focused developer creating ultra-fast, clean pages.

Given content extracted from a webpage, generate a COMPLETE HTML document that:
- Is extremely lightweight and fast
- Uses minimal CSS (under 5KB)
- Has a simple, clean aesthetic
- Loads nearly instantly
- Works great on slow connections
- Uses system fonts only
- Has no generated images

Design style: Brutalist simplicity. Fast and functional. Think craigslist meets modern minimalism.
${RESPONSE_FORMAT}`,
    userPromptTemplate: `Transform this content into an ultra-clean, fast-loading page:

{CONTENT}

Create the simplest possible HTML document that still looks good and is easy to read.`,
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Your own instructions',
    icon: '✎',
    supportsImages: true,
    systemPrompt: `You are a versatile web designer following custom instructions.

Generate a COMPLETE HTML document based on the user's specific requirements.
${RESPONSE_FORMAT_WITH_IMAGES}`,
    userPromptTemplate: `{CUSTOM_PROMPT}

Here is the content to transform:

{CONTENT}`,
  },
];

export function getRecipe(id: string): Recipe | undefined {
  return BUILT_IN_RECIPES.find(r => r.id === id);
}

export function buildPrompt(
  recipe: Recipe, 
  content: string, 
  customPrompt?: string, 
  includeImages?: boolean
): { system: string; user: string } {
  let systemPrompt = recipe.systemPrompt;
  let userPrompt = recipe.userPromptTemplate.replace('{CONTENT}', content);
  
  // If images are requested but recipe doesn't have image format, add it
  if (includeImages && !recipe.supportsImages) {
    systemPrompt = systemPrompt.replace(RESPONSE_FORMAT, RESPONSE_FORMAT_WITH_IMAGES);
    userPrompt += '\n\nAlso include 1-2 AI-generated images that would enhance this content.';
  }
  
  if (customPrompt) {
    userPrompt = userPrompt.replace('{CUSTOM_PROMPT}', customPrompt);
  }
  
  return {
    system: systemPrompt,
    user: userPrompt,
  };
}
