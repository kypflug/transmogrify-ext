# Focus Remix - Edge Extension Development Guidelines

## Project Overview
This is a Microsoft Edge browser extension (Manifest V3) that "remixes" web pages by mutating the live DOM to improve readability, focus, and content layout. Think of it as a "super duper reading mode" or "focus remix" tool.

## Tech Stack
- **Platform**: Microsoft Edge Extension (Manifest V3)
- **Language**: TypeScript
- **Build Tool**: Vite
- **UI Framework**: Vanilla TypeScript (lightweight for extension popup)
- **Content Scripts**: DOM manipulation via TypeScript

## Project Structure
```
remix-ext/
├── src/
│   ├── content/          # Content scripts injected into pages
│   │   ├── index.ts      # Main content script entry
│   │   ├── remixer.ts    # Core DOM remixing logic
│   │   └── styles.css    # Injected styles
│   ├── popup/            # Extension popup UI
│   │   ├── popup.html
│   │   ├── popup.ts
│   │   └── popup.css
│   ├── background/       # Service worker
│   │   └── service-worker.ts
│   └── shared/           # Shared utilities and types
│       ├── types.ts
│       └── utils.ts
├── public/
│   ├── manifest.json
│   └── icons/
├── dist/                 # Build output (load this in Edge)
└── vite.config.ts
```

## Development Commands
- `npm run dev` - Build with watch mode
- `npm run build` - Production build
- `npm run lint` - Run ESLint

## Loading the Extension in Edge
1. Run `npm run build`
2. Open Edge and navigate to `edge://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist` folder

## Key Implementation Patterns

### Content Script Communication
Use `chrome.runtime.sendMessage` and `chrome.runtime.onMessage` for popup ↔ content script communication.

### DOM Remixing Strategy
1. Parse and analyze page structure
2. Identify main content vs. noise (ads, sidebars, etc.)
3. Apply user-selected remix mode
4. Preserve essential functionality while simplifying layout

### Remix Modes to Implement
- **Focus Mode**: Hide distractions, center main content
- **Reader Mode**: Article-optimized layout with typography improvements
- **Custom Remix**: User-defined CSS/layout rules

## Code Style
- Use TypeScript strict mode
- Prefer functional patterns where possible
- Keep content scripts lightweight for performance
- Use semantic HTML in popup UI
