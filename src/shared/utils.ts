/**
 * Shared utility functions for Transmogrifier extension
 */

import { UserPreferences, DEFAULT_PREFERENCES } from './types';

/**
 * Load user preferences from chrome.storage
 */
export async function loadPreferences(): Promise<UserPreferences> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['preferences'], (result) => {
      if (result.preferences) {
        resolve({ ...DEFAULT_PREFERENCES, ...result.preferences });
      } else {
        resolve(DEFAULT_PREFERENCES);
      }
    });
  });
}

/**
 * Save user preferences to chrome.storage
 */
export async function savePreferences(preferences: Partial<UserPreferences>): Promise<void> {
  const current = await loadPreferences();
  const updated = { ...current, ...preferences };
  return new Promise((resolve) => {
    chrome.storage.sync.set({ preferences: updated }, resolve);
  });
}

/**
 * Get the current tab's hostname
 */
export async function getCurrentTabHostname(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        try {
          const url = new URL(tabs[0].url);
          resolve(url.hostname);
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Check if a site is in the enabled/disabled list
 */
export function isSiteEnabled(hostname: string, preferences: UserPreferences): boolean {
  if (preferences.disabledSites.includes(hostname)) {
    return false;
  }
  // If enabledSites is empty, default to enabled for all
  if (preferences.enabledSites.length === 0) {
    return true;
  }
  return preferences.enabledSites.includes(hostname);
}

/**
 * Debounce function for performance optimization
 */
export function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Generate a unique ID for DOM elements
 */
export function generateId(): string {
  return `transmogrify-${Math.random().toString(36).substring(2, 9)}`;
}
