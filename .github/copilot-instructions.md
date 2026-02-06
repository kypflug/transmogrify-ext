# Transmogrifier - Edge Extension Development Guidelines

## Project Overview
This is a Microsoft Edge browser extension (Manifest V3) that "transmogrifies" web pages by mutating the live DOM to improve readability, focus, and content layout. Think of it as a "super duper reading mode" or "Transmogrifier" tool.

## Tech Stack
- **Platform**: Microsoft Edge Extension (Manifest V3)
- **Language**: TypeScript
- **Build Tool**: Vite
- **UI Framework**: Vanilla TypeScript (lightweight for extension popup)
- **Content Scripts**: DOM manipulation via TypeScript

## Project Structure
```
remix-ext/
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ src/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ content/          # Content scripts injected into pages
Ã¢â€â€š   Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ index.ts      # Main content script entry
Ã¢â€â€š   Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ remixer.ts    # Core DOM remixing logic
Ã¢â€â€š   Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ styles.css    # Injected styles
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ popup/            # Extension popup UI
Ã¢â€â€š   Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ popup.html
Ã¢â€â€š   Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ popup.ts
Ã¢â€â€š   Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ popup.css
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ background/       # Service worker
Ã¢â€â€š   Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ service-worker.ts
Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ shared/           # Shared utilities and types
Ã¢â€â€š       Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ types.ts
Ã¢â€â€š       Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ utils.ts
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ public/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ manifest.json
Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ icons/
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ dist/                 # Build output (load this in Edge)
Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ vite.config.ts
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
Use `chrome.runtime.sendMessage` and `chrome.runtime.onMessage` for popup Ã¢â€ â€ content script communication.

### DOM Transmogrification Strategy
1. Parse and analyze page structure
2. Identify main content vs. noise (ads, sidebars, etc.)
3. Apply user-selected Transmogrify mode
4. Preserve essential functionality while simplifying layout

### Transmogrifier Modes to Implement
- **Focus Mode**: Hide distractions, center main content
- **Reader Mode**: Article-optimized layout with typography improvements
- **Custom Transmogrify**: User-defined CSS/layout rules

## Code Style
- Use TypeScript strict mode
- Prefer functional patterns where possible
- Keep content scripts lightweight for performance
- Use semantic HTML in popup UI
