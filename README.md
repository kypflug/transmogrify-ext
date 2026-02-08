# Transmogrifier

An AI-powered Microsoft Edge extension that "transmogrifies" web pages into beautiful, focused reading experiences. Uses a large language model to generate complete HTML documents with optional AI-generated images.

Supports **multiple AI providers** out of the box — Azure OpenAI, OpenAI, Anthropic (Claude), and Google (Gemini). Bring your own API key.

## Features

- **AI-Powered Transformation**: Generates complete, standalone HTML documents via your preferred LLM
- **Multi-Provider Support**: Azure OpenAI, OpenAI, Anthropic (Claude), or Google (Gemini)
- **AI Image Generation**: Optional image generation via Azure OpenAI, OpenAI, or Google Gemini
- **Built-in Recipes**: Focus, Reader, Aesthetic, Illustrated, Visualize, Declutter, Interview, and Custom modes
- **Pin Favorites**: Pin preferred recipes to the top of the list
- **Library**: Full two-pane article browser with search, filtering, sorting, and inline reading
- **Saved Articles**: IndexedDB storage for unlimited article saving
- **OneDrive Sync**: Sign in with a Microsoft account to sync articles across devices via OneDrive AppData
- **Respin**: Re-transform saved articles with different recipes
- **Parallel Jobs**: Run multiple jobs simultaneously with independent progress tracking
- **Live Library Updates**: Library auto-refreshes when articles are added, deleted, or synced
- **In-Progress Tracking**: Active remixes appear in the Library sidebar with live status
- **Content Script Re-injection**: Automatically re-injects content scripts after extension reload
- **Keyboard Shortcuts**: `j`/`k` to browse articles, `f` to favorite, `Delete` to remove, `/` to search
- **Dark Mode**: All recipes respect `prefers-color-scheme`
- **New Tab View**: Open any article as a clean standalone page
- **Export**: Save articles as standalone HTML files

## Companion PWA

The **Library of Transmogrifia** ([kypflug/transmogrifia-pwa](https://github.com/kypflug/transmogrifia-pwa)) is a standalone Progressive Web App for reading transmogrified articles on any device — phone, tablet, or desktop — without the extension. It shares the same Azure AD app registration, OneDrive `articles/` AppFolder, and `OneDriveArticleMeta` schema, so articles created by the extension appear automatically in the PWA and vice versa for metadata changes (favorites).

## Setup

### Prerequisites
- Node.js 18+
- An API key from **one** of the supported providers:
  - [Azure OpenAI](https://learn.microsoft.com/azure/ai-services/openai/)
  - [OpenAI](https://platform.openai.com/api-keys)
  - [Anthropic (Claude)](https://console.anthropic.com/)
  - [Google (Gemini)](https://aistudio.google.com/apikey)
- (Optional) An image-capable API key (Azure OpenAI, OpenAI, or Google) for AI image generation
- (Optional) Azure app registration for OneDrive sync

### Configuration

1. Copy `.env.example` to `.env`
2. Set `VITE_AI_PROVIDER` to your provider and fill in the matching credentials.

Only the variables for your chosen provider need to be set — the rest can stay commented out.

#### Azure OpenAI
```env
VITE_AI_PROVIDER=azure-openai
VITE_AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
VITE_AZURE_OPENAI_API_KEY=your-key
VITE_AZURE_OPENAI_DEPLOYMENT=gpt-5.2
VITE_AZURE_OPENAI_API_VERSION=2024-10-21
```

#### OpenAI
```env
VITE_AI_PROVIDER=openai
VITE_OPENAI_API_KEY=sk-...
VITE_OPENAI_MODEL=gpt-4o          # or gpt-4.1, o3, etc.
```

#### Anthropic (Claude)
```env
VITE_AI_PROVIDER=anthropic
VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

#### Google (Gemini)
```env
VITE_AI_PROVIDER=google
VITE_GOOGLE_API_KEY=AIza...
VITE_GOOGLE_MODEL=gemini-2.0-flash
```

#### Image Generation (optional)
Image generation is available with Azure OpenAI, OpenAI, or Google Gemini. Set `VITE_IMAGE_PROVIDER` and the matching key:

```env
# Azure OpenAI image generation
VITE_IMAGE_PROVIDER=azure-openai
VITE_AZURE_IMAGE_ENDPOINT=https://your-resource.openai.azure.com
VITE_AZURE_IMAGE_API_KEY=your-image-key
VITE_AZURE_IMAGE_DEPLOYMENT=gpt-image-1.5
```

```env
# OpenAI direct image generation
VITE_IMAGE_PROVIDER=openai
VITE_OPENAI_IMAGE_MODEL=gpt-image-1   # or dall-e-3
# Uses VITE_OPENAI_API_KEY by default, or set VITE_OPENAI_IMAGE_API_KEY
```

```env
# Google Gemini image generation (Nano Banana)
VITE_IMAGE_PROVIDER=google
VITE_GOOGLE_IMAGE_MODEL=gemini-2.5-flash-image  # or gemini-3-pro-image-preview
# Uses VITE_GOOGLE_API_KEY by default, or set VITE_GOOGLE_IMAGE_API_KEY
```

Set `VITE_IMAGE_PROVIDER=none` (or omit it) to disable image generation entirely.

> **Note:** Anthropic does not currently offer an image generation API.

### Build
```bash
npm install
npm run build
```

### Load in Edge
1. Navigate to `edge://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist` folder

## Usage
1. Visit any webpage
2. Click the Transmogrifier extension icon
3. Choose a recipe (Focus, Reader, Illustrated, etc.)
4. (Optional) Toggle "Generate AI Images" for visual enhancements
5. Click **"✨ Transmogrify & Read"** to start the job and open the Library, or **"📥 Send to Library"** to queue it silently
6. The popup dismisses immediately; the AI generates the article in the background
7. Articles are automatically saved and browsable in the Library

### Library
Click "Library" in the popup to open the full Library view. The Library provides:
- Two-pane layout: article list on the left, reader on the right
- Search, filter by recipe/favorites, and sort (newest, oldest, A-Z)
- Inline article reading in a sandboxed iframe
- Action bar: Favorite, Save, Original link, New Tab view, Respin, Delete
- Resizable sidebar with drag handle
- Keyboard shortcuts: `j`/`k` or `↑`/`↓` to browse and open articles, `f` to favorite, `Delete` to remove, `/` to search
- Floating shortcut legend in the bottom-right corner
- In-progress remixes shown at the top of the sidebar with live status and cancel button
- Sync status bar with sign-in and manual sync

### Parallel Jobs
You can start multiple jobs on different tabs simultaneously. Active jobs appear in the popup and the Library sidebar with live progress and cancel buttons.

### Respin
Open a saved article and click "Respin" to re-transform it with a different recipe without re-extracting from the original page.

### OneDrive Sync
Sign in via the Library's sync bar to enable cross-device article sync through OneDrive. Articles are pushed to the cloud on save/delete/favorite and pulled periodically (every 5 minutes) or on demand.

## Recipes

| Recipe | Description |
|--------|-------------|
| Focus Mode | Strips distractions and centers content in a calm, book-like layout |
| Reader Mode | Editorial magazine layout with drop caps, pull quotes, and refined type |
| Aesthetic | Bold, artistic redesign with dramatic layouts and color |
| Illustrated | Adds AI-generated photos and illustrations in a warm editorial style |
| Visualize | Turns concepts into annotated diagrams and data-rich layouts |
| Declutter | Ultra-lightweight brutalist page with minimal CSS |
| Interview | Reformats Q&A and interviews as a messaging chat with speech bubbles |
| Custom | Write your own prompt for full creative control |

All recipes include:
- Dark mode support (`prefers-color-scheme`)
- Readable typography (65-75ch line width, 1.6-1.8 line-height)
- Generous whitespace and breathing room
- 4.5:1 minimum contrast ratio

## Project Structure
```
src/
+-- content/              # Content scripts
|   +-- content-extractor.ts  # Semantic content extraction
|   +-- index.ts              # Message handling
+-- popup/                # Extension popup (recipe picker + library link)
+-- library/              # Full-page article browser
|   +-- library.html
|   +-- library.css
|   +-- library.ts
+-- viewer/               # Article viewer page
+-- background/           # Service worker (orchestration)
+-- shared/               # Types, recipes, services
    +-- ai-service.ts         # Multi-provider AI API (Azure OpenAI / OpenAI / Anthropic / Google)
    +-- image-service.ts      # Image generation API (Azure OpenAI / OpenAI / Google Gemini)
    +-- config.ts             # Provider selection & env-var loading
    +-- storage-service.ts    # IndexedDB storage
    +-- auth-service.ts       # Microsoft OAuth2 PKCE
    +-- onedrive-service.ts   # OneDrive Graph API client
    +-- sync-service.ts       # Bidirectional sync orchestrator
    +-- recipes.ts            # Recipe definitions
```

## Documentation
- [claude.md](./claude.md) - AI development guide
- [CHANGELOG.md](./CHANGELOG.md) - Version history

## License
MIT
