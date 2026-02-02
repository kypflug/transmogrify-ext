/**
 * DOM Extractor
 * Converts the live DOM into a compact, AI-friendly representation
 * that captures structure and content while staying within token limits
 */

export interface DOMNode {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;        // Direct text content (truncated)
  attributes?: Record<string, string>;
  children?: DOMNode[];
  selector: string;     // Unique CSS selector path
  meta?: {
    isVisible: boolean;
    rect?: { width: number; height: number; top: number };
    textLength: number;
  };
}

export interface ExtractedDOM {
  url: string;
  title: string;
  tree: DOMNode;
  stats: {
    totalElements: number;
    extractedElements: number;
    estimatedTokens: number;
  };
}

// Tags to skip entirely
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'path', 'meta', 'link',
  'br', 'hr', 'img', 'input', 'button', 'select', 'textarea',
  'iframe', 'video', 'audio', 'canvas', 'map', 'source', 'track'
]);

// Important attributes to preserve
const IMPORTANT_ATTRS = new Set([
  'role', 'aria-label', 'aria-hidden', 'data-testid', 'data-section',
  'href', 'type', 'name'
]);

export class DOMExtractor {
  private maxDepth: number;
  private maxTextLength: number;
  private maxChildren: number;
  private totalElements = 0;
  private extractedElements = 0;

  constructor(options: {
    maxDepth?: number;
    maxTextLength?: number;
    maxChildren?: number;
  } = {}) {
    this.maxDepth = options.maxDepth ?? 15;
    this.maxTextLength = options.maxTextLength ?? 100;
    this.maxChildren = options.maxChildren ?? 50;
  }

  /**
   * Extract a compact representation of the DOM
   */
  extract(): ExtractedDOM {
    this.totalElements = 0;
    this.extractedElements = 0;

    const tree = this.extractNode(document.body, 0, 'body');
    const estimatedTokens = this.estimateTokens(tree);

    return {
      url: window.location.href,
      title: document.title,
      tree: tree!,
      stats: {
        totalElements: this.totalElements,
        extractedElements: this.extractedElements,
        estimatedTokens,
      },
    };
  }

  /**
   * Extract a simplified text-based representation (even more compact)
   */
  extractSimplified(): string {
    const lines: string[] = [];
    lines.push(`URL: ${window.location.href}`);
    lines.push(`Title: ${document.title}`);
    lines.push('');
    lines.push('=== PAGE STRUCTURE ===');
    
    this.extractNodeAsText(document.body, 0, lines, 'body');
    
    return lines.join('\n');
  }

  private extractNode(el: Element, depth: number, path: string): DOMNode | null {
    this.totalElements++;
    
    const tag = el.tagName.toLowerCase();
    
    // Skip unwanted elements
    if (SKIP_TAGS.has(tag)) return null;
    if (depth > this.maxDepth) return null;
    
    // Check visibility (skip hidden elements)
    const style = window.getComputedStyle(el);
    const isVisible = style.display !== 'none' && 
                      style.visibility !== 'hidden' &&
                      style.opacity !== '0';
    
    if (!isVisible && tag !== 'body') return null;

    this.extractedElements++;

    const node: DOMNode = {
      tag,
      selector: path,
    };

    // Add ID if present
    if (el.id) {
      node.id = el.id;
      node.selector = `#${el.id}`;
    }

    // Add meaningful classes (filter out utility classes)
    const classes = Array.from(el.classList)
      .filter(c => !this.isUtilityClass(c))
      .slice(0, 5);
    if (classes.length > 0) {
      node.classes = classes;
    }

    // Add important attributes
    const attrs: Record<string, string> = {};
    for (const attr of IMPORTANT_ATTRS) {
      const val = el.getAttribute(attr);
      if (val) attrs[attr] = val.slice(0, 50);
    }
    if (Object.keys(attrs).length > 0) {
      node.attributes = attrs;
    }

    // Add direct text content (not from children)
    const directText = this.getDirectText(el);
    if (directText) {
      node.text = directText.slice(0, this.maxTextLength);
    }

    // Add metadata for important elements
    if (this.isImportantElement(el)) {
      const rect = el.getBoundingClientRect();
      node.meta = {
        isVisible,
        rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top) },
        textLength: (el.textContent || '').length,
      };
    }

    // Process children
    const children: DOMNode[] = [];
    let childIndex = 0;
    for (const child of el.children) {
      if (childIndex >= this.maxChildren) break;
      
      const childPath = node.id 
        ? `#${node.id} > ${child.tagName.toLowerCase()}:nth-child(${childIndex + 1})`
        : `${path} > ${child.tagName.toLowerCase()}:nth-child(${childIndex + 1})`;
      
      const childNode = this.extractNode(child, depth + 1, childPath);
      if (childNode) {
        children.push(childNode);
        childIndex++;
      }
    }
    
    if (children.length > 0) {
      node.children = children;
    }

    return node;
  }

  private extractNodeAsText(el: Element, depth: number, lines: string[], path: string): void {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (depth > this.maxDepth) return;

    const indent = '  '.repeat(depth);
    const id = el.id ? `#${el.id}` : '';
    const classes = Array.from(el.classList)
      .filter(c => !this.isUtilityClass(c))
      .slice(0, 3)
      .map(c => `.${c}`)
      .join('');
    
    const role = el.getAttribute('role');
    const roleStr = role ? ` [role=${role}]` : '';
    
    const directText = this.getDirectText(el);
    const textPreview = directText ? ` "${directText.slice(0, 60)}${directText.length > 60 ? '...' : ''}"` : '';
    
    // Build selector for this element
    const selector = id || (el.className ? `${tag}${classes}` : tag);
    
    lines.push(`${indent}<${selector}${roleStr}>${textPreview}`);

    // Recurse into children
    let childCount = 0;
    for (const child of el.children) {
      if (childCount >= this.maxChildren) {
        lines.push(`${indent}  ... (${el.children.length - childCount} more children)`);
        break;
      }
      this.extractNodeAsText(child, depth + 1, lines, path);
      childCount++;
    }
  }

  private getDirectText(el: Element): string {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent || '';
      }
    }
    return text.trim().replace(/\s+/g, ' ');
  }

  private isUtilityClass(className: string): boolean {
    // Filter out common CSS framework utility classes
    const utilityPatterns = [
      /^(mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py)-/,  // Spacing
      /^(text|bg|border)-/,                         // Colors
      /^(flex|grid|block|inline|hidden)$/,          // Display
      /^(w|h|min|max)-/,                            // Sizing
      /^(sm|md|lg|xl|2xl):/,                        // Responsive
      /^(hover|focus|active):/,                     // States
      /^[a-z]{1,3}-\d+$/,                           // Tailwind-like
    ];
    return utilityPatterns.some(p => p.test(className));
  }

  private isImportantElement(el: Element): boolean {
    const tag = el.tagName.toLowerCase();
    const semanticTags = ['main', 'article', 'aside', 'nav', 'header', 'footer', 'section'];
    return semanticTags.includes(tag) || 
           el.hasAttribute('role') || 
           el.id !== '';
  }

  private estimateTokens(node: DOMNode | null): number {
    if (!node) return 0;
    
    let tokens = 5; // Base for tag, selector
    if (node.id) tokens += 2;
    if (node.classes) tokens += node.classes.length * 2;
    if (node.text) tokens += Math.ceil(node.text.length / 4);
    if (node.attributes) tokens += Object.keys(node.attributes).length * 3;
    
    for (const child of node.children || []) {
      tokens += this.estimateTokens(child);
    }
    
    return tokens;
  }
}

/**
 * Quick extraction function for common use
 */
export function extractDOM(simplified = true): string | ExtractedDOM {
  const extractor = new DOMExtractor();
  return simplified ? extractor.extractSimplified() : extractor.extract();
}
