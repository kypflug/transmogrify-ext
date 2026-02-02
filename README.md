# Focus Remix

An AI-powered Microsoft Edge extension that "remixes" web pages into beautiful, focused reading experiences. Uses GPT-5.2 to generate complete HTML documents with optional AI-generated images via gpt-image-1.5.

## Features

- **AI-Powered Transformation**: GPT-5.2 generates complete, standalone HTML documents
- **AI Image Generation**: Optional gpt-image-1.5 integration for diagrams and illustrations
- **Built-in Recipes**: Focus, Reader, Declutter, Zen, Research, Illustrated, Visualize, Aesthetic modes
- **Saved Articles**: IndexedDB storage for unlimited article saving
- **Respin**: Re-transform saved articles with different recipes
- **Parallel Remixes**: Run multiple remixes simultaneously with independent progress tracking
- **Dark Mode**: All recipes respect `prefers-color-scheme`
- **Export**: Save articles as standalone HTML files

## Setup

### Prerequisites
- Node.js 18+
- Azure OpenAI API access with GPT-5.2 deployment
- (Optional) Azure OpenAI API access with gpt-image-1.5 deployment

### Configuration
1. Copy `.env.example` to `.env`
2. Add your Azure OpenAI credentials:
```
VITE_AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
VITE_AZURE_OPENAI_API_KEY=your-key
VITE_AZURE_OPENAI_DEPLOYMENT=gpt-5.2
```

3. (Optional) Add image generation credentials:
```
VITE_AZURE_IMAGE_ENDPOINT=https://your-image-resource.openai.azure.com
VITE_AZURE_IMAGE_API_KEY=your-image-key
VITE_AZURE_IMAGE_DEPLOYMENT=gpt-image-1.5
```

### Build
```bash
npm install
npm run build
```

### Load in Edge
1. Navigate to `edge://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `dist` folder

## Usage
1. Visit any webpage
2. Click the Focus Remix extension icon
3. Choose a recipe (Focus, Reader, Illustrated, etc.)
4. (Optional) Toggle "Generate AI Images" for visual enhancements
5. Click "Remix → New Tab"
6. The AI generates a beautiful new version in a viewer tab
7. Articles are automatically saved and accessible from the "Saved" tab

### Parallel Remixes
You can start multiple remixes on different tabs simultaneously. The popup shows all active remixes with progress and cancel buttons.

### Respin
Open a saved article and click "Respin" to re-transform it with a different recipe without re-extracting from the original page.

## Recipes

| Recipe | Description |
|--------|-------------|
| Focus | Clean, distraction-free reading with centered content |
| Reader | Article-optimized layout with refined typography |
| Declutter | Ultra-lightweight, fast-loading version |
| Zen | Minimal, calming aesthetic |
| Research | Preserve structure while improving readability |
| Illustrated | Add 5-10 AI-generated illustrations |
| Visualize | Generate diagrams and infographics |
| Aesthetic | Bold, artistic presentation |
| Custom | Write your own AI prompt |

All recipes include:
- Dark mode support (`prefers-color-scheme`)
- Readable typography (65-75ch line width, 1.6-1.8 line-height)
- Generous whitespace and breathing room
- 4.5:1 minimum contrast ratio

## Project Structure
```
src/
├── content/              # Content scripts
│   ├── content-extractor.ts  # Semantic content extraction
│   └── index.ts              # Message handling
├── popup/                # Extension popup (tabbed UI)
├── viewer/               # Article viewer page
├── background/           # Service worker (orchestration)
└── shared/               # Types, recipes, services
    ├── ai-service.ts         # GPT-5.2 API
    ├── image-service.ts      # gpt-image-1.5 API
    ├── storage-service.ts    # IndexedDB storage
    └── recipes.ts            # Recipe definitions
```

## Documentation
- [claude.md](./claude.md) - AI development guide
- [spec.md](./spec.md) - Product specification
- [docs/parallel-remix-plan.md](./docs/parallel-remix-plan.md) - Parallel remix architecture

## License
MIT
