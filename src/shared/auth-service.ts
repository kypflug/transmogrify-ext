/**
 * Microsoft Authentication Service for Transmogrifier
 * OAuth2 PKCE flow via chrome.identity.launchWebAuthFlow
 * Targets Microsoft personal accounts (consumers)
 */

const CLIENT_ID = '4b54bcee-1c83-4f52-9faf-d0dfd89c5ac2';
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read', 'offline_access'];

// Token storage keys (in chrome.storage.local — session storage not available in MV3 service workers)
const TOKEN_KEY = 'msaTokens';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  userName?: string;
  userEmail?: string;
}

/**
 * Get the redirect URI for this extension
 */
function getRedirectUri(): string {
  return chrome.identity.getRedirectURL();
}

/**
 * Generate cryptographic random string for PKCE
 */
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

/**
 * Generate PKCE code verifier + challenge
 */
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateRandomString(64);
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { verifier, challenge };
}

/**
 * Sign in with Microsoft account
 * Launches the OAuth2 PKCE flow via chrome.identity
 */
export async function signIn(): Promise<AuthTokens> {
  const { verifier, challenge } = await generatePKCE();
  const redirectUri = getRedirectUri();
  const state = generateRandomString(32);

  const authUrl = new URL(`${AUTHORITY}/authorize`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('prompt', 'select_account');

  console.log('[Auth] Launching auth flow, redirect:', redirectUri);

  // Launch the web auth flow
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  if (!responseUrl) {
    throw new Error('Auth flow cancelled or failed');
  }

  // Extract authorization code from redirect URL
  // Azure AD returns params in query string (response_mode=query) or fragment (SPA default)
  const url = new URL(responseUrl);
  const params = url.searchParams.has('code') || url.searchParams.has('error')
    ? url.searchParams
    : new URLSearchParams(url.hash.replace('#', ''));
  const code = params.get('code');
  const returnedState = params.get('state');
  const error = params.get('error');

  if (error) {
    const errorDesc = url.searchParams.get('error_description') || error;
    throw new Error(`Auth error: ${errorDesc}`);
  }

  if (!code) {
    throw new Error('No authorization code in response');
  }

  if (returnedState !== state) {
    throw new Error('State mismatch — possible CSRF attack');
  }

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code, verifier, redirectUri);

  // Fetch user profile
  const profile = await fetchUserProfile(tokens.accessToken);
  tokens.userName = profile.displayName;
  tokens.userEmail = profile.mail || profile.userPrincipalName;

  // Store tokens
  await storeTokens(tokens);

  console.log('[Auth] Signed in as', tokens.userEmail);
  return tokens;
}

/**
 * Exchange authorization code for access + refresh tokens
 */
async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string
): Promise<AuthTokens> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: SCOPES.join(' '),
  });

  const response = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${err.error_description || response.statusText}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - 60_000, // 1 min buffer
  };
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPES.join(' '),
  });

  const response = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Token refresh failed: ${err.error_description || response.statusText}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken, // May or may not rotate
    expiresAt: Date.now() + (data.expires_in * 1000) - 60_000,
  };
}

/**
 * Get a valid access token, refreshing if needed
 * Returns null if not signed in
 */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await getStoredTokens();
  if (!tokens) return null;

  // Check if token is still valid
  if (Date.now() < tokens.expiresAt) {
    return tokens.accessToken;
  }

  // Try to refresh
  try {
    console.log('[Auth] Refreshing access token...');
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    refreshed.userName = tokens.userName;
    refreshed.userEmail = tokens.userEmail;
    await storeTokens(refreshed);
    return refreshed.accessToken;
  } catch (err) {
    console.error('[Auth] Token refresh failed:', err);
    // Clear invalid tokens
    await clearTokens();
    return null;
  }
}

/**
 * Fetch user profile from Graph API
 */
async function fetchUserProfile(accessToken: string): Promise<{
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user profile');
  }

  return response.json();
}

/**
 * Sign out — clear stored tokens
 */
export async function signOut(): Promise<void> {
  await clearTokens();
  console.log('[Auth] Signed out');
}

/**
 * Check if user is signed in (has stored tokens)
 */
export async function isSignedIn(): Promise<boolean> {
  const tokens = await getStoredTokens();
  return tokens !== null;
}

/**
 * Get stored user info (name/email) without exposing tokens
 */
export async function getUserInfo(): Promise<{ name: string; email: string } | null> {
  const tokens = await getStoredTokens();
  if (!tokens) return null;
  return {
    name: tokens.userName || '',
    email: tokens.userEmail || '',
  };
}

// ─── Token Storage Helpers ───────────────────────────

async function storeTokens(tokens: AuthTokens): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: tokens });
}

async function getStoredTokens(): Promise<AuthTokens | null> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return result[TOKEN_KEY] || null;
}

async function clearTokens(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}
