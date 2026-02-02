# Focus Remix - AI Development Guide

## Project Context
Focus Remix is a Microsoft Edge extension (Manifest V3) that transforms web pages using **AI-powered DOM analysis**. Instead of heuristics, it sends a compact DOM representation to GPT-5.2 (via Azure OpenAI) which analyzes the page and returns precise CSS selectors and modifications to apply.

**New in v2**: Optional AI image generation using gpt-image-1 for diagrams, illustrations, and backgrounds.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│     Popup UI    │────►│  Service Worker  │────►│ Content Script  │
│   (popup.ts)    │     │ (background.ts)  │     │  (index.ts)     │
└─────────────────┘     └────────┬─────────┘     └────────┬────────┘
                                 │                        │
                    ┌────────────▼────────────┐   ┌───────▼────────┐
                    │    Azure OpenAI API     │   │  DOM Extractor │
                    │  GPT-5.2 + gpt-image-1  │   │  ai-remixer.ts │
                    └─────────────────────────┘   └────────────────┘
```

**Flow:**
1. User selects a recipe and clicks "Remix"
2. Popup sends `AI_ANALYZE` message to service worker
3. Service worker requests DOM extraction from content script
4. Content script extracts compact DOM representation
5. Service worker sends DOM + recipe prompt to Azure OpenAI GPT-5.2
6. AI returns JSON with selectors to hide, main content, custom CSS, and image placeholders
7. If images enabled, service worker calls gpt-image-1 for each placeholder
8. Service worker sends `APPLY_REMIX` with AI response + generated images to content script
9. Content script applies the mutations via `AIRemixer` (including inserting images)

## Key Files & Responsibilities

| File | Purpose |
|------|---------|
| `src/content/dom-extractor.ts` | Converts live DOM to compact text representation |
| `src/content/ai-remixer.ts` | Applies AI-generated mutations (hide, modify, inject CSS, insert images) |
| `src/content/index.ts` | Content script message handling |
| `src/shared/ai-service.ts` | Azure OpenAI API integration (GPT-5.2) |
| `src/shared/image-service.ts` | Azure OpenAI image generation (gpt-image-1) |
| `src/shared/recipes.ts` | Built-in prompts and recipe system |
| `src/shared/config.ts` | Environment configuration |
| `src/popup/popup.ts` | UI for recipe selection |
| `src/background/service-worker.ts` | Orchestrates AI analysis + image generation flow |

## Recipe System

Built-in recipes in `recipes.ts`:
- **Focus** - Hide distractions, emphasize main content
- **Reader** - Extract article for clean reading
- **Declutter** - Remove ads and banners moderately
- **Zen** - Maximum minimalism
- **Research** - Keep metadata and references
- **Illustrated** - Add diagrams and illustrations (image-aware)
- **Visualize** - Generate infographics and data visualizations (image-aware)
- **Aesthetic** - Add artistic backgrounds and visual flair (image-aware)
- **Custom** - User writes their own prompt

### Adding a New Recipe
```typescript
// In src/shared/recipes.ts
{
  id: 'myrecipe',
  name: 'My Recipe',
  description: 'What it does',
  icon: '🎯',
  systemPrompt: `Instructions for the AI...`,
  userPromptTemplate: `Analyze this page:\n\n{DOM}\n\nUser goal: ...`,
}
```

## AI Response Format

The AI returns JSON:
```typescript
interface AIResponse {
  hide?: string[];           // CSS selectors to hide
  mainContent?: string;      // Selector for main content
  customCSS?: string;        // Additional CSS to inject
  modify?: Array<{           // Element modifications
    selector: string;
    styles: Record<string, string>;
  }>;
  imagePlaceholders?: Array<{  // Images to generate (when enabled)
    id: string;                // Unique identifier
    prompt: string;            // Prompt for gpt-image-1
    position: 'before' | 'after' | 'prepend' | 'append' | 'replace-background';
    targetSelector: string;    // Where to insert the image
    width?: number;            // Image dimensions
    height?: number;
  }>;
  explanation?: string;      // What the AI did
}
```

## Image Generation

When the user enables "Generate AI Images", the system:
1. Passes `includeImages: true` to the AI service
2. AI returns `imagePlaceholders` array with prompts and positions
3. Service worker calls `generateImages()` from `image-service.ts`
4. Images are generated via gpt-image-1 and returned as base64 data URLs
5. `AIRemixer.insertImages()` places them in the DOM at specified positions

### Image Positions
- `before` - Insert as sibling before target element
- `after` - Insert as sibling after target element  
- `prepend` - Insert as first child of target element
- `append` - Insert as last child of target element
- `replace-background` - Set as CSS background-image of target

## DOM Extraction

The `DOMExtractor` class creates a compact representation:
- Skips scripts, styles, images, inputs
- Preserves semantic structure (tag names, IDs, classes)
- Includes text snippets for context
- Estimates ~5-15K tokens for typical pages

### Tuning Extraction
```typescript
const extractor = new DOMExtractor({
  maxDepth: 15,        // How deep to traverse
  maxTextLength: 100,  // Text snippet length
  maxChildren: 50,     // Children per element
});
```

## Environment Configuration

Create `.env` with:
```
# GPT-5.2 for DOM analysis
VITE_AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
VITE_AZURE_OPENAI_API_KEY=your-key
VITE_AZURE_OPENAI_DEPLOYMENT=gpt-52
VITE_AZURE_OPENAI_API_VERSION=2024-10-21

# (Optional) gpt-image-1 for AI image generation
VITE_AZURE_IMAGE_ENDPOINT=https://your-image-resource.openai.azure.com
VITE_AZURE_IMAGE_API_KEY=your-image-key
VITE_AZURE_IMAGE_DEPLOYMENT=gpt-image-1
VITE_AZURE_IMAGE_API_VERSION=2024-10-21
```

## Security Notes
- API key is embedded at build time (extension-only use)
- CSS from AI is sanitized (no `expression()`, `javascript:`, etc.)
- Allowed style properties are whitelisted
- No user JavaScript execution

## Testing Checklist
- [ ] Test recipes on news sites, docs, social media
- [ ] Verify AI returns valid CSS selectors
- [ ] Check cleanup fully restores page
- [ ] Test with API errors/timeouts
- [ ] Verify custom prompt works
- [ ] Test image generation with Illustrated/Visualize/Aesthetic recipes
- [ ] Verify images appear in correct positions
- [ ] Test with image generation disabled

## Future Ideas
- [ ] Cache AI responses per domain
- [ ] Site-specific recipe presets
- [ ] Streaming AI responses for faster feedback
- [ ] Local LLM option for privacy
- [ ] Image caching to avoid regeneration
- [ ] User-editable image prompts
