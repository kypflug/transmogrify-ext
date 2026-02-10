/**
 * Recipes for Cloud Transmogrification
 * 
 * This is a lightweight wrapper that references recipe IDs and provides
 * the prompt-building logic. The full recipe definitions are shared with
 * the extension — we import the recipe map at build time.
 * 
 * For the cloud function, we bundle a portable copy of the recipe prompts
 * so the function doesn't depend on the extension's Vite build.
 */

// We re-export a minimal Recipe type and the prompt builder.
// The full recipe corpus is copied from the extension's recipes.ts at build time.
// For now we import the built-in recipes from a generated file.

export interface Recipe {
  id: string;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  supportsImages?: boolean;
}

// Map of recipe ID → { name, id } for display purposes
export const RECIPE_NAMES: Record<string, string> = {
  focus: 'Focus Mode',
  reader: 'Reader Mode',
  aesthetic: 'Aesthetic',
  illustrated: 'Illustrated',
  visualize: 'Visualize',
  declutter: 'Declutter',
  interview: 'Interview',
  custom: 'Custom',
};

/**
 * Build the system + user prompts for a given recipe and content.
 * This is the server-side equivalent of the extension's buildPrompt().
 * 
 * For the cloud version, we use the Focus recipe as the default since
 * it doesn't require images (which the cloud function doesn't currently support).
 * Full recipe prompts are loaded from the shared recipe definitions.
 */
export function buildCloudPrompt(
  recipeId: string,
  content: string,
  customPrompt?: string,
): { system: string; user: string } {
  // The cloud function uses a simplified prompt that still produces beautiful
  // standalone HTML. We import the full recipe prompts from a shared location.
  // For now, the FOCUS recipe is inlined as the default; others are loaded dynamically.
  
  const recipeName = RECIPE_NAMES[recipeId] || 'Focus Mode';

  const RESPONSE_FORMAT = `
You MUST respond with a JSON object containing these fields:
{
  "html": "<!DOCTYPE html>...(complete HTML document)...",
  "explanation": "Brief explanation of your design choices"
}

HTML REQUIREMENTS:
- Output a COMPLETE, valid HTML5 document with <!DOCTYPE html>, <html>, <head>, and <body>
- Include all CSS inline in a <style> tag in <head>
- Use semantic HTML5 elements (article, section, header, main, figure, etc.)
- Make it fully responsive with mobile-first CSS
- Use modern CSS (flexbox, grid, custom properties, clamp())
- Include a viewport meta tag
- Preserve ALL substantive content from the source - don't summarize or truncate
- DISCARD any obvious website UI debris: nav links, follow buttons, cookie prompts, share widgets, subscription CTAs, ad text
- Convert markdown-style links [text](url) to proper <a> tags
- For images, use the provided src URLs directly

TYPOGRAPHY:
- Import 1-2 distinctive Google Fonts via <link> in <head>
- NEVER use Inter, Roboto, Arial, Helvetica, or system font stacks as primary font
- Body text: 16-20px, line-height 1.6-1.8
- Headings: dramatic scale contrast with clamp()

COLOR & THEME:
- Commit to a strong, cohesive palette with CSS custom properties
- Include @media (prefers-color-scheme: dark) with intentionally designed dark mode
- Include <meta name="color-scheme" content="light dark">

ACCESSIBILITY:
- Proper heading hierarchy, alt text, good contrast (4.5:1+), focus states
- prefers-reduced-motion support

CRITICAL: Output the full HTML as a single string in the "html" field. Escape quotes using \\" and newlines using \\n.
`;

  // Build based on recipe ID
  let system: string;
  let user: string;

  switch (recipeId) {
    case 'focus':
      system = `You are a typographer crafting a contemplative reading sanctuary.
Given content extracted from a webpage, generate a COMPLETE HTML document.
AESTHETIC: "Japanese stationery meets Scandinavian calm" — centered column (62ch), generous whitespace, warm parchment tones.
TYPOGRAPHY: Import "Literata" (body) and "Fraunces" (headings) from Google Fonts.
COLOR: Light: off-white #FAF8F5, warm charcoal #2C2825, terracotta accent #C4654A. Dark: #1C1917, cream #E8E0D8, amber #D4976A.
${RESPONSE_FORMAT}`;
      user = `Transform this content into a focused, contemplative reading experience:\n\n${content}`;
      break;

    case 'reader':
      system = `You are an editorial designer at a world-class literary magazine.
Given content extracted from a webpage, generate a COMPLETE HTML document.
AESTHETIC: "The Paris Review meets Monocle" — refined editorial with drop caps, pull quotes.
TYPOGRAPHY: Import "Newsreader" (body) and "Bricolage Grotesque" (headings) from Google Fonts.
COLOR: Light: #FFFEF9, near-black #141210, vermillion #E23D28. Dark: #0F0E0C, off-white #F5F0E8, coral #FF6B52.
${RESPONSE_FORMAT}`;
      user = `Transform this content into a beautifully typeset editorial article:\n\n${content}`;
      break;

    case 'aesthetic':
      system = `You are an avant-garde creative director designing an immersive digital experience.
Given content, generate a COMPLETE HTML document.
Pick ONE of: "Late-night Tokyo neon", "Bauhaus exhibition", "70s Saul Bass poster", "Contemporary art gallery", "Retro-futurism terminal". Commit fully.
Use dramatic typography, bold color, and creative layouts. Make it visually striking and memorable.
${RESPONSE_FORMAT}`;
      user = `Transform this content into a VISUALLY STRIKING creative experience:\n\n${content}\n\nPick a strong aesthetic mood and commit fully.`;
      break;

    case 'illustrated':
      system = `You are a designer at a boutique editorial studio specializing in illustrated digital features.
Given content, generate a COMPLETE HTML document.
AESTHETIC: "Kinfolk meets National Geographic" — warm, intentional.
TYPOGRAPHY: Import "Source Serif 4" (body) and "Cormorant Garamond" (headings).
COLOR: warm linen #F4EDE4, deep walnut #2A241E, sage #6B7F5E, terra cotta #C67B5C.
NOTE: Since this is server-side, use placeholder images or relevant Unsplash URLs where images would enhance the content.
${RESPONSE_FORMAT}`;
      user = `Transform this content into a beautifully illustrated editorial feature:\n\n${content}`;
      break;

    case 'visualize':
      system = `You are an information designer inspired by Edward Tufte and the NYT data viz team.
Given content, generate a COMPLETE HTML document with diagrams and infographics using SVG and CSS.
Create visual representations: flow diagrams, comparison matrices, annotated layouts, timelines.
TYPOGRAPHY: Import "IBM Plex Sans" and "IBM Plex Mono".
${RESPONSE_FORMAT}`;
      user = `Transform this content into a visually rich, data-informed document with diagrams:\n\n${content}`;
      break;

    case 'declutter':
      system = `You are a clarity-obsessed editor.
Given content, generate a COMPLETE HTML document that strips away ALL fluff.
Restructure into clear sections with headings. Use bullet points for series. Highlight key takeaways.
TYPOGRAPHY: Import "DM Sans" for a clean, modern feel. Minimal decoration.
${RESPONSE_FORMAT}`;
      user = `Declutter this content — strip away all fluff and present the essential information clearly:\n\n${content}`;
      break;

    case 'interview':
      system = `You are a chat interface designer.
Given content (especially conversations, interviews, Q&As), generate a COMPLETE HTML document styled as a messaging interface.
Use speech bubbles, avatars (CSS-generated initials), timestamps.
TYPOGRAPHY: Import "DM Sans" for a native-app feel.
${RESPONSE_FORMAT}`;
      user = `Transform this content into a chat-style conversation:\n\n${content}`;
      break;

    case 'custom':
    default:
      system = `You are a versatile web designer who takes creative direction and runs with it.
Generate a COMPLETE HTML document based on the user's requirements.
Make BOLD choices — distinctive typography, committed palettes, atmospheric backgrounds.
${RESPONSE_FORMAT}`;
      user = customPrompt
        ? `${customPrompt}\n\nHere is the content to transform:\n\n${content}`
        : `Transform this content into a beautiful standalone HTML document:\n\n${content}`;
      break;
  }

  return { system, user };
}
