/**
 * Recipe System
 * Built-in and custom prompts for AI-powered DOM remixing
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
  /** Unique ID for this image placeholder */
  id: string;
  /** CSS selector where image should be inserted */
  insertAt: string;
  /** Position relative to insertAt element */
  position: 'before' | 'after' | 'prepend' | 'append' | 'replace-background';
  /** Detailed prompt for image generation */
  prompt: string;
  /** Image dimensions */
  size?: '1024x1024' | '1024x1792' | '1792x1024';
  /** Style hint */
  style?: 'natural' | 'vivid';
  /** Alt text for accessibility */
  altText: string;
  /** Optional CSS classes to apply */
  cssClasses?: string;
}

export interface AIResponse {
  /** CSS selectors to hide completely */
  hide?: string[];
  /** CSS selector for the main content to preserve/highlight */
  mainContent?: string;
  /** Custom CSS to inject */
  customCSS?: string;
  /** Elements to modify with specific styles */
  modify?: Array<{
    selector: string;
    styles: Record<string, string>;
  }>;
  /** Image placeholders to generate and insert */
  images?: ImagePlaceholder[];
  /** Explanation of what the AI decided to do */
  explanation?: string;
}

const RESPONSE_FORMAT = `
Respond with a JSON object containing these optional fields:
{
  "hide": ["selector1", "selector2"],  // CSS selectors for elements to hide
  "mainContent": "selector",            // CSS selector for the main content
  "customCSS": "css rules",             // Additional CSS to inject
  "modify": [                           // Elements to modify
    { "selector": "sel", "styles": { "property": "value" } }
  ],
  "explanation": "Brief explanation of changes"
}

IMPORTANT:
- Use precise CSS selectors that will match elements on this page
- Prefer ID selectors (#id) when available
- Use class selectors (.class) or tag[attribute] patterns
- For hiding, target containers rather than individual items
- Ensure mainContent selector captures the primary article/content
`;

const RESPONSE_FORMAT_WITH_IMAGES = `
Respond with a JSON object containing these fields:
{
  "hide": ["selector1", "selector2"],  // CSS selectors for elements to hide
  "mainContent": "selector",            // CSS selector for the main content
  "customCSS": "css rules",             // Additional CSS to inject
  "modify": [                           // Elements to modify
    { "selector": "sel", "styles": { "property": "value" } }
  ],
  "images": [                           // Images to generate and insert
    {
      "id": "hero-image",               // Unique identifier
      "insertAt": "#main-content",      // CSS selector for insertion point
      "position": "prepend",            // before|after|prepend|append|replace-background
      "prompt": "Detailed image generation prompt describing the visual...",
      "size": "1792x1024",              // 1024x1024, 1024x1792, or 1792x1024
      "style": "natural",               // natural or vivid
      "altText": "Description for accessibility",
      "cssClasses": "hero-img rounded"  // Optional CSS classes
    }
  ],
  "explanation": "Brief explanation of changes"
}

IMAGE GUIDELINES:
- Generate images that complement and enhance the page content
- Use specific, detailed prompts describing style, colors, mood, and subject
- Consider the page's topic and tone when designing images
- For diagrams, describe the visual structure clearly
- For backgrounds, use subtle, non-distracting imagery
- Match the visual style to the content (technical = clean diagrams, articles = relevant imagery)
- Limit to 1-3 images maximum to keep load times reasonable

IMPORTANT:
- Use precise CSS selectors that will match elements on this page
- Prefer ID selectors (#id) when available
- Ensure mainContent selector captures the primary article/content
`;

export const BUILT_IN_RECIPES: Recipe[] = [
  {
    id: 'focus',
    name: 'Focus Mode',
    description: 'Hide distractions, emphasize main content',
    icon: '◎',
    supportsImages: false,
    systemPrompt: `You are a web page analyzer that helps users focus on content. Your job is to identify:
1. The main content area (article, post, documentation)
2. Distracting elements (ads, sidebars, popups, promotional banners, related content, social widgets)
3. Navigation that could be hidden without losing context

Be aggressive about hiding distractions but careful to preserve the core content.
${RESPONSE_FORMAT}`,
    userPromptTemplate: `Analyze this page and identify what to hide for a focused reading experience:

{DOM}

The user wants to focus on the main content without distractions.`,
  },
  {
    id: 'reader',
    name: 'Reader Mode',
    description: 'Extract article content for clean reading',
    icon: '☰',
    supportsImages: false,
    systemPrompt: `You are a content extraction expert. Your job is to:
1. Identify the primary article/content container
2. Hide everything else (header, footer, sidebars, comments, ads)
3. Suggest CSS to improve typography and readability

The goal is a clean, distraction-free reading experience.
${RESPONSE_FORMAT}`,
    userPromptTemplate: `Extract the main readable content from this page:

{DOM}

Identify the article content and hide everything else for a clean reader view.`,
  },
  {
    id: 'illustrated',
    name: 'Illustrated',
    description: 'Add AI-generated images to enhance content',
    icon: '🎨',
    supportsImages: true,
    systemPrompt: `You are a creative web designer who enhances pages with AI-generated imagery. Your job is to:
1. Analyze the page content and identify key themes, topics, and mood
2. Hide distracting elements (ads, sidebars, clutter)
3. Suggest 1-3 AI-generated images that would enhance the content:
   - A hero/header image that captures the main theme
   - Supporting diagrams or illustrations for complex concepts
   - Decorative backgrounds that set the right mood
4. Write detailed, evocative prompts for each image

Consider the content type:
- Technical docs → Clean diagrams, flowcharts, architectural illustrations
- News/articles → Relevant photorealistic or editorial imagery
- Blogs → Warm, engaging illustrations matching the author's tone
- Product pages → Professional, polished visuals
${RESPONSE_FORMAT_WITH_IMAGES}`,
    userPromptTemplate: `Analyze this page and suggest AI-generated images to enhance the reading experience:

{DOM}

Create a visually enhanced version with relevant, AI-generated imagery.`,
  },
  {
    id: 'visualize',
    name: 'Visualize',
    description: 'Generate diagrams and infographics',
    icon: '📊',
    supportsImages: true,
    systemPrompt: `You are a data visualization and diagram expert. Your job is to:
1. Identify concepts, processes, or data that could be better understood with visuals
2. Hide distracting elements to focus on the content
3. Generate 1-3 images that visualize key information:
   - Flowcharts for processes
   - Diagrams for architectures or relationships
   - Infographics for data or statistics
   - Concept maps for complex ideas
4. Write precise prompts that describe the diagram structure clearly

Image prompts should specify:
- The type of diagram (flowchart, mind map, architecture diagram, etc.)
- Key elements and their relationships
- Visual style (minimalist, technical, colorful, etc.)
- Color scheme suggestions
${RESPONSE_FORMAT_WITH_IMAGES}`,
    userPromptTemplate: `Analyze this page and create visualizations for complex concepts:

{DOM}

Generate diagrams or infographics that help explain the content visually.`,
  },
  {
    id: 'aesthetic',
    name: 'Aesthetic',
    description: 'Transform with artistic backgrounds and imagery',
    icon: '✨',
    supportsImages: true,
    systemPrompt: `You are an artistic web designer who transforms pages into visually stunning experiences. Your job is to:
1. Understand the page's content and emotional tone
2. Hide all distractions and clutter
3. Generate 1-2 artistic images:
   - A beautiful background that sets the mood
   - Optional accent imagery that complements the content
4. Apply styling for a cohesive aesthetic experience

Consider artistic styles:
- Minimalist and clean for professional content
- Warm and cozy for personal blogs
- Bold and vibrant for creative content
- Serene and calming for wellness/lifestyle
- Dark and moody for dramatic effect
${RESPONSE_FORMAT_WITH_IMAGES}`,
    userPromptTemplate: `Transform this page into a visually aesthetic experience:

{DOM}

Create a beautiful, artistic presentation of the content.`,
  },
  {
    id: 'declutter',
    name: 'Declutter',
    description: 'Remove visual noise while keeping structure',
    icon: '🧹',
    supportsImages: false,
    systemPrompt: `You are a UI simplification expert. Your job is to:
1. Identify and hide ads, banners, and promotional content
2. Remove floating elements, popups, and overlays
3. Simplify without removing navigation or useful page elements

Be moderate - remove noise but keep the page functional.
${RESPONSE_FORMAT}`,
    userPromptTemplate: `Declutter this page by removing visual noise:

{DOM}

Remove ads, banners, and promotional content while keeping the page functional.`,
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Write your own instructions',
    icon: '✎',
    supportsImages: true,
    systemPrompt: `You are a web page transformation expert. Follow the user's specific instructions to modify the page.

If the user requests images, include them in your response.
${RESPONSE_FORMAT_WITH_IMAGES}`,
    userPromptTemplate: `{CUSTOM_PROMPT}

Here is the page structure:

{DOM}`,
  },
];

export function getRecipe(id: string): Recipe | undefined {
  return BUILT_IN_RECIPES.find(r => r.id === id);
}

export function buildPrompt(recipe: Recipe, dom: string, customPrompt?: string, includeImages?: boolean): { system: string; user: string } {
  let systemPrompt = recipe.systemPrompt;
  let userPrompt = recipe.userPromptTemplate.replace('{DOM}', dom);
  
  // If images are requested but recipe doesn't have image format, add it
  if (includeImages && !recipe.supportsImages) {
    systemPrompt = systemPrompt.replace(RESPONSE_FORMAT, RESPONSE_FORMAT_WITH_IMAGES);
    userPrompt += '\n\nAlso suggest 1-2 AI-generated images that would enhance this content.';
  }
  
  if (customPrompt) {
    userPrompt = userPrompt.replace('{CUSTOM_PROMPT}', customPrompt);
  }
  
  return {
    system: systemPrompt,
    user: userPrompt,
  };
}
