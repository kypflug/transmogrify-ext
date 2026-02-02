# Focus Remix - AI Development Guide

## Project Context
Focus Remix is a Microsoft Edge extension (Manifest V3) that transforms web pages into beautiful, focused reading experiences using **AI-powered HTML generation**. It extracts semantic content from pages and uses GPT-5.2 to generate complete, standalone HTML documents.

**Key Features**:
- Complete HTML generation (not DOM mutation)
- IndexedDB storage for saved articles
- Parallel remix support with independent progress tracking
- Optional AI image generation via gpt-image-1.5
- Dark mode support (`prefers-color-scheme`)

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Popup UI      │────►│  Service Worker  │────►│ Content Script  │
│  (tabbed UI)    │     │  (orchestrator)  │     │  (extractor)    │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
     ┌────────────────┐  ┌─────────────┐  ┌────────────────┐
     │  Azure OpenAI  │  │  IndexedDB  │  │  Viewer Page   │
     │ GPT-5.2 + img  │  │  (storage)  │  │  (display)     │
     └────────────────┘  └─────────────┘  └────────────────┘
```

**Flow:**
1. User selects a recipe and clicks "Remix → New Tab"
2. Service worker generates a unique request ID for tracking
3. Content script extracts semantic content (text, structure, metadata)
4. Service worker sends content + recipe prompt to GPT-5.2
5. AI returns complete HTML document as JSON
6. (Optional) Service worker generates images via gpt-image-1.5
7. Article saved to IndexedDB with original content for respins
8. Viewer page opens displaying the remixed article

## Key Files & Responsibilities

| File | Purpose |
|------|---------|
| `src/content/content-extractor.ts` | Extracts semantic content from pages |
| `src/content/index.ts` | Content script message handling |
| `src/shared/ai-service.ts` | Azure OpenAI GPT-5.2 integration |
| `src/shared/image-service.ts` | Azure OpenAI gpt-image-1.5 integration |
| `src/shared/storage-service.ts` | IndexedDB article storage |
| `src/shared/recipes.ts` | Built-in prompts and response format |
| `src/popup/popup.ts` | Tabbed UI (Remix + Saved Articles) |
| `src/viewer/viewer.ts` | Article viewer with toolbar |
| `src/background/service-worker.ts` | Orchestrates parallel remixes |

## Parallel Remix System

Each remix gets a unique `requestId` for independent tracking:

```typescript
interface RemixRequest {
  requestId: string;      // UUID
  tabId: number;          // Source tab
  status: RemixStatus;    // extracting | analyzing | generating-images | saving | complete | error
  step: string;           // Current step description
  startTime: number;
  pageTitle: string;
  recipeId: string;
  error?: string;
  articleId?: string;     // Set on completion
}
```

Active remixes stored in `chrome.storage.local` as `activeRemixes` map.
AbortControllers stored in memory for cancel support.

## Recipe System

Built-in recipes in `recipes.ts`:
- **Focus** - Clean, distraction-free reading
- **Reader** - Article-optimized typography
- **Declutter** - Ultra-lightweight version
- **Zen** - Minimal, calming aesthetic
- **Research** - Preserve structure while improving readability
- **Illustrated** - Add 5-10 AI-generated illustrations
- **Visualize** - Generate diagrams and infographics
- **Aesthetic** - Bold, artistic presentation
- **Custom** - User writes their own prompt

All recipes enforce:
- Dark mode support via `prefers-color-scheme`
- Readable typography (65-75ch width, 1.6-1.8 line-height)
- Generous whitespace
- 4.5:1 minimum contrast

### Adding a New Recipe
```typescript
// In src/shared/recipes.ts
{
  id: 'myrecipe',
  name: 'My Recipe',
  description: 'What it does',
  icon: '🎯',
  supportsImages: false,  // or true for image-enabled recipes
  systemPrompt: `Instructions for the AI...`,
  userPromptTemplate: `Transform this content:\n\n{CONTENT}`,
}
```

## AI Response Format

The AI returns JSON:
```typescript
interface AIResponse {
  html: string;              // Complete HTML document
  images?: ImagePlaceholder[]; // For image-enabled recipes
  explanation?: string;      // Design choices explanation
}

interface ImagePlaceholder {
  id: string;           // e.g., "hero-image"
  prompt: string;       // Detailed prompt for gpt-image-1.5
  size?: string;        // "1024x1024" | "1024x1536" | "1536x1024"
  style?: string;       // "natural" | "vivid"
  altText: string;      // Accessibility
  placement: string;    // "hero" | "inline" | "background" | "accent"
}
```

Images are inserted via `{{image-id}}` placeholders in the HTML src attributes.

## Image Generation

When the user enables "Generate AI Images":
1. Recipe's `supportsImages: true` adds image instructions to prompt
2. AI returns `images` array with prompts and placements
3. Service worker calls gpt-image-1.5 for each image
4. Images returned as base64, converted to data URLs
5. Placeholders (`{{image-id}}`) replaced in HTML before saving

### Supported Image Sizes
- `1024x1024` - Square (default)
- `1024x1536` - Portrait
- `1536x1024` - Landscape

## Content Extraction

The `ContentExtractor` extracts semantic content:
- Title, author, date, site name
- Main article text with structure preserved
- Headings, lists, blockquotes, code blocks
- Image references (URLs and alt text)
- Links converted to markdown format

Output is clean text/markdown, not raw HTML.

## Storage System

Articles stored in IndexedDB via `storage-service.ts`:

```typescript
interface SavedArticle {
  id: string;              // Timestamp-based unique ID
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  html: string;            // Complete generated HTML
  originalContent: string; // For respin capability
  createdAt: number;
  isFavorite: boolean;
}
```

Storage supports: save, get, getAll, delete, toggleFavorite, export to file.

## Environment Configuration

Create `.env` with:
```
# GPT-5.2 for HTML generation
VITE_AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
VITE_AZURE_OPENAI_API_KEY=your-key
VITE_AZURE_OPENAI_DEPLOYMENT=gpt-5.2
VITE_AZURE_OPENAI_API_VERSION=2024-10-21

# (Optional) gpt-image-1.5 for AI image generation
VITE_AZURE_IMAGE_ENDPOINT=https://your-image-resource.openai.azure.com
VITE_AZURE_IMAGE_API_KEY=your-image-key
VITE_AZURE_IMAGE_DEPLOYMENT=gpt-image-1.5
VITE_AZURE_IMAGE_API_VERSION=2024-10-21
```

## API Notes
- GPT-5.2 uses `max_completion_tokens` (not `max_tokens`)
- Default timeout: 2 min (5 min for image-heavy recipes)
- Default max tokens: 16K (48K for image-heavy recipes)
- gpt-image-1.5 supports sizes: 1024x1024, 1024x1536, 1536x1024
- AbortController support for request cancellation

## Security Notes
- API keys embedded at build time (extension-only use)
- Generated HTML displayed in sandboxed iframe
- No external resources loaded from generated HTML
- Images stored as embedded base64 data URLs

## Testing Checklist
- [ ] Test recipes on news sites, blogs, documentation
- [ ] Verify dark mode works correctly
- [ ] Test parallel remixes (start 2-3 simultaneously)
- [ ] Test cancel functionality
- [ ] Verify saved articles persist across sessions
- [ ] Test respin with different recipes
- [ ] Test export to HTML file
- [ ] Verify anchor links work in viewer
- [ ] Test image generation with Illustrated recipe
- [ ] Test with API errors/timeouts

## Future Ideas
- [ ] Queue system for many parallel remixes
- [ ] Browser notifications when remix completes
- [ ] Site-specific recipe presets
- [ ] Streaming AI responses for faster feedback
- [ ] Image caching to avoid regeneration
- [ ] Sync articles across devices
