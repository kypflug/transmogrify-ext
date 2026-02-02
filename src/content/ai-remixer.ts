/**
 * Focus Remix - AI-Powered DOM Remixer
 * Applies AI-generated mutations to transform page layouts
 */

import { AIResponse, ImagePlaceholder } from '../shared/recipes';

/** Generated image data passed from background script */
export interface GeneratedImageData {
  id: string;
  dataUrl: string;
  altText: string;
}

export class AIRemixer {
  private originalStyles: Map<Element, string> = new Map();
  private hiddenElements: Element[] = [];
  private addedElements: Element[] = [];
  private isActive = false;

  private readonly PREFIX = 'focus-remix';

  /**
   * Apply AI-generated remix instructions to the page
   */
  apply(response: AIResponse, generatedImages?: GeneratedImageData[]): void {
    // Remove any existing remix first
    if (this.isActive) {
      this.remove();
    }

    this.isActive = true;
    document.body.classList.add(`${this.PREFIX}-active`);

    // Hide elements
    if (response.hide && response.hide.length > 0) {
      this.hideElements(response.hide);
    }

    // Highlight main content
    if (response.mainContent) {
      this.highlightMainContent(response.mainContent);
    }

    // Apply custom CSS
    if (response.customCSS) {
      this.injectCSS(response.customCSS);
    }

    // Apply element modifications
    if (response.modify && response.modify.length > 0) {
      this.modifyElements(response.modify);
    }

    // Insert generated images
    if (response.images && generatedImages && generatedImages.length > 0) {
      this.insertImages(response.images, generatedImages);
    }

    console.log('[Focus Remix] Applied AI remix:', response.explanation || 'No explanation');
  }

  /**
   * Remove all remix modifications and restore original page
   */
  remove(): void {
    if (!this.isActive) return;

    // Restore hidden elements
    this.hiddenElements.forEach((el) => {
      el.classList.remove(`${this.PREFIX}-hidden`);
      const originalDisplay = el.getAttribute('data-focus-remix-display');
      if (originalDisplay) {
        (el as HTMLElement).style.display = originalDisplay;
        el.removeAttribute('data-focus-remix-display');
      } else {
        (el as HTMLElement).style.display = '';
      }
    });
    this.hiddenElements = [];

    // Restore original inline styles
    this.originalStyles.forEach((style, element) => {
      if (style) {
        (element as HTMLElement).style.cssText = style;
      } else {
        (element as HTMLElement).removeAttribute('style');
      }
    });
    this.originalStyles.clear();

    // Remove added elements (injected styles, images, etc.)
    this.addedElements.forEach((el) => el.remove());
    this.addedElements = [];

    // Remove all our CSS classes
    document.querySelectorAll(`[class*="${this.PREFIX}"]`).forEach((el) => {
      const classesToRemove: string[] = [];
      el.classList.forEach((cls) => {
        if (cls.startsWith(this.PREFIX)) {
          classesToRemove.push(cls);
        }
      });
      classesToRemove.forEach((cls) => el.classList.remove(cls));
    });

    document.body.classList.remove(`${this.PREFIX}-active`);
    this.isActive = false;

    console.log('[Focus Remix] Removed all remix modifications');
  }

  /**
   * Hide elements matching the given selectors
   */
  private hideElements(selectors: string[]): void {
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => {
          // Save original display value
          const currentDisplay = (el as HTMLElement).style.display;
          if (currentDisplay && currentDisplay !== 'none') {
            el.setAttribute('data-focus-remix-display', currentDisplay);
          }
          
          (el as HTMLElement).style.display = 'none';
          el.classList.add(`${this.PREFIX}-hidden`);
          this.hiddenElements.push(el);
        });
        
        if (elements.length > 0) {
          console.log(`[Focus Remix] Hidden ${elements.length} elements: ${selector}`);
        }
      } catch (error) {
        console.warn(`[Focus Remix] Invalid selector: ${selector}`, error);
      }
    }
  }

  /**
   * Highlight the main content area
   */
  private highlightMainContent(selector: string): void {
    try {
      const mainContent = document.querySelector(selector);
      if (mainContent) {
        this.saveOriginalStyle(mainContent);
        mainContent.classList.add(`${this.PREFIX}-main-content`);
        
        // Apply subtle highlighting
        Object.assign((mainContent as HTMLElement).style, {
          position: 'relative',
          zIndex: '100',
        });
        
        console.log(`[Focus Remix] Highlighted main content: ${selector}`);
      } else {
        console.warn(`[Focus Remix] Main content not found: ${selector}`);
      }
    } catch (error) {
      console.warn(`[Focus Remix] Invalid main content selector: ${selector}`, error);
    }
  }

  /**
   * Inject custom CSS into the page
   */
  private injectCSS(css: string): void {
    const styleEl = document.createElement('style');
    styleEl.className = `${this.PREFIX}-injected-style`;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
    this.addedElements.push(styleEl);
    
    console.log('[Focus Remix] Injected custom CSS');
  }

  /**
   * Modify elements with specific styles
   */
  private modifyElements(modifications: Array<{ selector: string; styles: Record<string, string> }>): void {
    for (const mod of modifications) {
      try {
        const elements = document.querySelectorAll(mod.selector);
        elements.forEach((el) => {
          this.saveOriginalStyle(el);
          Object.assign((el as HTMLElement).style, mod.styles);
        });
        
        if (elements.length > 0) {
          console.log(`[Focus Remix] Modified ${elements.length} elements: ${mod.selector}`);
        }
      } catch (error) {
        console.warn(`[Focus Remix] Invalid selector for modification: ${mod.selector}`, error);
      }
    }
  }

  /**
   * Insert generated images into the page
   */
  private insertImages(placeholders: ImagePlaceholder[], images: GeneratedImageData[]): void {
    // Create a map of image data by ID
    const imageMap = new Map(images.map((img) => [img.id, img]));

    for (const placeholder of placeholders) {
      const imageData = imageMap.get(placeholder.id);
      if (!imageData) {
        console.warn(`[Focus Remix] No image data for placeholder: ${placeholder.id}`);
        continue;
      }

      try {
        const targetElement = document.querySelector(placeholder.insertAt);
        if (!targetElement) {
          console.warn(`[Focus Remix] Target element not found: ${placeholder.insertAt}`);
          continue;
        }

        if (placeholder.position === 'replace-background') {
          // Set as background image
          this.saveOriginalStyle(targetElement);
          Object.assign((targetElement as HTMLElement).style, {
            backgroundImage: `url(${imageData.dataUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          });
          console.log(`[Focus Remix] Set background image on: ${placeholder.insertAt}`);
        } else {
          // Create image element
          const img = document.createElement('img');
          img.src = imageData.dataUrl;
          img.alt = imageData.altText || placeholder.altText;
          img.className = `${this.PREFIX}-generated-image ${placeholder.cssClasses || ''}`;
          
          // Apply default styling
          Object.assign(img.style, {
            maxWidth: '100%',
            height: 'auto',
            display: 'block',
            margin: '1rem auto',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          });

          // Insert at specified position
          switch (placeholder.position) {
            case 'before':
              targetElement.parentNode?.insertBefore(img, targetElement);
              break;
            case 'after':
              targetElement.parentNode?.insertBefore(img, targetElement.nextSibling);
              break;
            case 'prepend':
              targetElement.insertBefore(img, targetElement.firstChild);
              break;
            case 'append':
              targetElement.appendChild(img);
              break;
          }

          this.addedElements.push(img);
          console.log(`[Focus Remix] Inserted image ${placeholder.id} at ${placeholder.position} of ${placeholder.insertAt}`);
        }
      } catch (error) {
        console.warn(`[Focus Remix] Failed to insert image ${placeholder.id}:`, error);
      }
    }
  }

  /**
   * Save original inline style for restoration
   */
  private saveOriginalStyle(el: Element): void {
    if (!this.originalStyles.has(el)) {
      this.originalStyles.set(el, (el as HTMLElement).style.cssText);
    }
  }
}
