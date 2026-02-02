# Focus Remix

An AI-powered Microsoft Edge extension that "remixes" web pages using GPT-5.2 to intelligently transform layouts for better focus and readability. Now with AI image generation powered by gpt-image-1.5!

## Features

- **AI-Powered Analysis**: Uses Azure OpenAI GPT-5.2 to analyze page structure and decide what to hide/modify
- **AI Image Generation**: Optional gpt-image-1.5 integration generates diagrams, illustrations, and backgrounds
- **Built-in Recipes**: Focus, Reader, Declutter, Zen, Research, Illustrated, Visualize, Aesthetic modes
- **Custom Prompts**: Write your own instructions for the AI
- **Smart DOM Extraction**: Sends a compact page representation to stay within token limits

## Setup

### Prerequisites
- Node.js 18+
- Azure OpenAI API access with GPT-5.2 deployment
- (Optional) Azure OpenAI API access with gpt-image-1 deployment for image generation

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
5. Click "Remix This Page"
6. The AI analyzes the page and applies transformations

## Recipes

| Recipe | Description |
|--------|-------------|
| Focus | Hide distractions, center main content |
| Reader | Article-optimized layout with clean typography |
| Declutter | Aggressive removal of non-essential elements |
| Zen | Minimal, calming aesthetic |
| Research | Preserve functionality while improving focus |
| Illustrated | Add AI-generated diagrams and illustrations |
| Visualize | Generate data visualizations and infographics |
| Aesthetic | Add artistic backgrounds and visual flair |
| Custom | Write your own AI prompt |

## Project Structure
```
src/
├── content/           # Content scripts
│   ├── dom-extractor.ts  # DOM → compact text
│   ├── ai-remixer.ts     # Apply AI mutations
│   └── index.ts          # Message handling
├── popup/             # Extension popup UI
├── background/        # Service worker (AI orchestration)
└── shared/            # Types, recipes, AI service
```

## Documentation
- [claude.md](./claude.md) - AI development guide
- [spec.md](./spec.md) - Product specification

## License
MIT
