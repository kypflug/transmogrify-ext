# Transmogrifier

An AI-powered Microsoft Edge extension that "transmogrifies" web pages into beautiful, focused reading experiences. Uses GPT-5.2 to generate complete HTML documents with optional AI-generated images via gpt-image-1.5.

## Features

- **AI-Powered Transformation**: GPT-5.2 generates complete, standalone HTML documents
- **AI Image Generation**: Optional gpt-image-1.5 integration for diagrams and illustrations
- **Built-in Recipes**: Focus, Reader, Aesthetic, Illustrated, Visualize, Clean, Interview, and Custom modes
- **Pin Favorites**: Pin preferred recipes to the top of the list
- **Saved Articles**: IndexedDB storage for unlimited article saving
- **Respin**: Re-transform saved articles with different recipes
- **Parallel Jobs**: Run multiple jobs simultaneously with independent progress tracking
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
3. Click "Load unpacked" Ã¢â€ â€™ select the `dist` folder

## Usage
1. Visit any webpage
2. Click the Transmogrifier extension icon
3. Choose a recipe (Focus, Reader, Illustrated, etc.)
4. (Optional) Toggle "Generate AI Images" for visual enhancements
5. Click "Transmogrify Ã¢â€ â€™ New Tab"
6. The AI generates a beautiful new version in a viewer tab
7. Articles are automatically saved and accessible from the "Saved" tab

### Parallel Jobs
You can start multiple jobs on different tabs simultaneously. The popup shows all Active Jobs with progress and cancel buttons.

### Respin
Open a saved article and click "Respin" to re-transform it with a different recipe without re-extracting from the original page.

## Recipes

| Recipe | Description |
|--------|-------------|
| Focus Mode | Strips distractions and centers content in a calm, book-like layout |
| Reader Mode | Editorial magazine layout with drop caps, pull quotes, and refined type |
| Aesthetic | Bold, artistic redesign with dramatic layouts and color |
| Illustrated | Adds AI-generated photos and illustrations in a warm editorial style |
| Visualize | Turns concepts into annotated diagrams and data-rich layouts |
| Clean | Ultra-lightweight brutalist page with minimal CSS |
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
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ content/              # Content scripts
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ content-extractor.ts  # Semantic content extraction
Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ index.ts              # Message handling
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ popup/                # Extension popup (tabbed UI)
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ viewer/               # Article viewer page
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ background/           # Service worker (orchestration)
Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ shared/               # Types, recipes, services
    Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ ai-service.ts         # GPT-5.2 API
    Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ image-service.ts      # gpt-image-1.5 API
    Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ storage-service.ts    # IndexedDB storage
    Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ recipes.ts            # Recipe definitions
```

## Documentation
- [claude.md](./claude.md) - AI development guide
- [spec.md](./spec.md) - Product specification
- [docs/parallel-remix-plan.md](./docs/parallel-remix-plan.md) - Parallel Transmogrify architecture

## License
MIT
