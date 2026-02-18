import { BUILT_IN_RECIPES, getRecipe } from '@kypflug/transmogrifier-core';

const FAST_RECIPE_ID = 'fast';
const LEGACY_DEFAULT_RECIPE_ID = 'reader';

export function getDefaultRecipeId(): string {
  return BUILT_IN_RECIPES.some(recipe => recipe.id === FAST_RECIPE_ID)
    ? FAST_RECIPE_ID
    : LEGACY_DEFAULT_RECIPE_ID;
}

export function recipeRequiresAI(recipeId: string): boolean {
  const recipe = getRecipe(recipeId) as any;
  if (!recipe) return true;
  if (recipe.renderMode === 'deterministic') return false;
  if (recipe.requiresAI === false) return false;
  return true;
}

/** True for purely deterministic recipes with no AI at all. */
export function isDeterministicRecipe(recipeId: string): boolean {
  const recipe = getRecipe(recipeId) as any;
  if (!recipe) return false;
  return recipe.renderMode === 'deterministic' || recipe.requiresAI === false;
}

/** True for recipes that use AI for content extraction but render with a static template. */
export function isAIExtractRecipe(recipeId: string): boolean {
  const recipe = getRecipe(recipeId) as any;
  if (!recipe) return false;
  return recipe.renderMode === 'ai-extract';
}

export function recipeCapabilityLabel(recipeId: string): 'No AI required' | 'AI required' {
  return recipeRequiresAI(recipeId) ? 'AI required' : 'No AI required';
}
