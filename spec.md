# Transmogrifier - Product Specification

## Overview
Transmogrifier is a Microsoft Edge browser extension that "transmogrifies" web pages by intelligently mutating the live DOM to improve readability, reduce distractions, and enhance content layout based on user preferences.

## Problem Statement
Modern web pages are cluttered with:
- Advertisements and promotional banners
- Sidebars with unrelated content
- Complex navigation elements
- Comments and social features
- Auto-playing media
- Poor typography and layout choices

Users need a tool that transforms any page into a focused, readable experience while preserving essential content and functionality.

## Target Users
- Knowledge workers who read many articles daily
- Students researching and studying online
- Anyone with attention or accessibility needs
- Developers reading documentation
- Users who want distraction-free browsing

## Core Features

### 1. Transmogrify Modes

#### 1.1 Focus Mode
**Purpose**: Hide distractions while keeping the page structure intact.

**Capabilities**:
- Hide advertisements and promotional content
- Remove sidebars and widget areas
- Hide comment sections
- Optional background dimming to spotlight main content
- Center main content for better readability

**User Controls**:
- Toggle each element type independently
- Adjust dimming intensity

#### 1.2 Reader Mode
**Purpose**: Extract main content and present in optimized reading layout.

**Capabilities**:
- Extract and isolate main article content
- Apply clean typography (configurable font, size, line height)
- Support multiple themes (light, dark, sepia)
- Constrain content width for optimal reading
- Full-screen overlay presentation

**User Controls**:
- Font family selection
- Font size slider (14-28px)
- Line height adjustment
- Content width slider (500-1000px)
- Theme selector
- Text justification toggle

#### 1.3 Custom Mode
**Purpose**: Allow power users to define their own transformations.

**Capabilities**:
- Custom CSS injection
- Saved per-site or global rules
- CSS editor with syntax highlighting (future)

### 2. Content Detection

The extension must intelligently identify:
- **Main Content**: The primary article or information on the page
- **Advertisements**: Ads, sponsored content, promotional banners
- **Navigation**: Menus, breadcrumbs, pagination
- **Sidebars**: Widget areas, related content, recommendations
- **Comments**: User comments, discussions, social features
- **Footers**: Site-wide footers, copyright, links

**Detection Methods**:
1. Semantic HTML elements (`<main>`, `<article>`, `<aside>`, etc.)
2. ARIA roles (`role="main"`, `role="complementary"`, etc.)
3. Common class/ID patterns
4. Heuristic analysis (content length, element dimensions)
5. Site-specific rules (future enhancement)

### 3. Site Management

**Per-Site Preferences**:
- Remember mode choice per domain
- Allowlist: Sites where extension auto-activates
- Blocklist: Sites where extension never activates
- Site-specific settings overrides

### 4. User Interface

#### 4.1 Popup Interface
- Current mode indicator
- Mode selection buttons (Off, Focus, Reader, Custom)
- Contextual settings panel for active mode
- Apply button to activate changes

#### 4.2 In-Page Controls
- Close button for Reader mode overlay
- Keyboard shortcut support (future)
- Floating toolbar option (future)

## Technical Requirements

### Browser Compatibility
- Microsoft Edge (primary target)
- Chromium-based browsers (Chrome, Brave, etc.)
- Manifest V3 compliance

### Permissions Required
- `activeTab`: Access current tab for DOM manipulation
- `storage`: Persist user preferences
- `scripting`: Inject content scripts dynamically
- `<all_urls>`: Content script injection on all sites

### Performance Requirements
- Content script initialization: < 50ms
- Mode application: < 200ms
- Mode removal (cleanup): < 100ms
- No perceptible impact on page scrolling
- Minimal memory footprint

### Data Storage
- Use `chrome.storage.sync` for cross-device sync
- Store: preferences, site lists, custom CSS
- Max storage: ~100KB (Chrome sync limit)

## User Stories

### US-1: Quick Focus
> As a user reading an article, I want to quickly hide sidebar distractions so I can focus on the content.

**Acceptance Criteria**:
- One-click activation from popup
- Sidebars hidden within 200ms
- Main content remains functional
- Can be reversed instantly

### US-2: Deep Reading
> As a user studying a technical document, I want to enter a distraction-free reading mode with comfortable typography.

**Acceptance Criteria**:
- Reader mode extracts main content
- Typography is pleasant (serif font, 18px, 1.6 line height)
- Can adjust settings without leaving reader mode
- Sepia theme available for reduced eye strain

### US-3: Custom Control
> As a power user, I want to inject custom CSS to handle sites that don't work well with preset modes.

**Acceptance Criteria**:
- Custom CSS textarea in popup
- CSS applies immediately on "Apply"
- CSS persists across sessions
- Invalid CSS doesn't crash the page

### US-4: Site Preferences
> As a frequent user, I want my preferred mode to auto-activate on my favorite news sites.

**Acceptance Criteria**:
- Can add current site to auto-activate list
- Extension remembers mode per site
- Can view and edit site list in settings

## Non-Functional Requirements

### Accessibility
- Popup UI keyboard navigable
- ARIA labels on all interactive elements
- Respects prefers-reduced-motion
- Reader mode improves accessibility by default

### Security
- No remote code execution
- Custom CSS sanitized (no `expression()`, `javascript:`, etc.)
- No data collection or telemetry
- Content Security Policy respected

### Privacy
- All data stored locally
- No external API calls
- No tracking or analytics

## Future Roadmap

### Phase 2
- Keyboard shortcuts
- Site-specific rule presets
- Reading progress indicator
- Print-optimized output

### Phase 3
- AI-powered content detection
- Community-shared site rules
- Browser reading list integration
- Annotation and highlighting

### Phase 4
- Text-to-speech integration
- Translation support
- Cross-browser sync
- Mobile browser support

## Success Metrics
- Extension installs
- Daily active users
- Mode activation frequency
- User retention (7-day, 30-day)
- User reviews and ratings

## Appendix

### A. Competitor Analysis
| Feature | Transmogrify | Reader View (Built-in) | Mercury Reader |
|---------|-------------|------------------------|----------------|
| Focus Mode | Ã¢Å“â€¦ | Ã¢ÂÅ’ | Ã¢ÂÅ’ |
| Reader Mode | Ã¢Å“â€¦ | Ã¢Å“â€¦ | Ã¢Å“â€¦ |
| Custom CSS | Ã¢Å“â€¦ | Ã¢ÂÅ’ | Ã¢ÂÅ’ |
| Themes | 3 | 1 | 2 |
| Per-site settings | Ã¢Å“â€¦ | Ã¢ÂÅ’ | Ã¢ÂÅ’ |
| Active Development | Ã¢Å“â€¦ | Varies | Ã¢ÂÅ’ |

### B. Content Selectors Reference
```css
/* Main Content */
main, article, [role="main"], #content, .content, 
.post-content, .article-content, .entry-content

/* Advertisements */
[class*="ad-"], [class*="ads-"], [id*="ad-"], 
ins.adsbygoogle, .sponsored, .promotion

/* Sidebars */
aside, [role="complementary"], .sidebar, #sidebar,
.widget-area, .side-panel

/* Comments */
.comments, #comments, #disqus_thread, .discussions
```
