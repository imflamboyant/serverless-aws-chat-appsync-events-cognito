// Sign-in with Cognito managed login: authorization code grant with PKCE, no dependencies.
// Tokens live in sessionStorage, so each browser tab keeps its own session.
(function () {
  const cfg = window.CHAT_CONFIG;
  const TOKENS_KEY = 'chat-tokens';
  const PKCE_KEY = 'chat-pkce';

  function base64url(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString() {
    return base64url(crypto.getRandomValues(new Uint8Array(32)));
  }

  // Redirect to the managed login page with a fresh code challenge
  async function signIn() {
    const verifier = randomString();
    const state = randomString();
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
    const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const url = new URL('/oauth2/authorize', cfg.cognitoDomain);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      scope: 'openid profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    location.assign(url);
  }

  async function requestTokens(params) {
    const response = await fetch(new URL('/oauth2/token', cfg.cognitoDomain), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, ...params }),
    });
    if (!response.ok) {
      throw new Error(`Token request failed: HTTP ${response.status}`);
    }
    const result = await response.json();
    const tokens = {
      idToken: result.id_token,
      // a refresh doesn't return a new refresh token, keep the old one
      refreshToken: result.refresh_token || params.refresh_token,
      expiresAt: Date.now() + result.expires_in * 1000,
    };
    sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    return tokens;
  }

  // Back from managed login with ?code=...&state=...: exchange the code for tokens
  async function handleRedirect() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code) return;
    const pkce = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
    sessionStorage.removeItem(PKCE_KEY);
    history.replaceState(null, '', cfg.redirectUri); // drop the code from the address bar
    if (!pkce || params.get('state') !== pkce.state) {
      throw new Error('Sign-in state mismatch');
    }
    await requestTokens({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: pkce.verifier,
    });
  }

  // A valid ID token, refreshed when it expires within a minute. null when signed out.
  async function getIdToken() {
    let tokens = JSON.parse(sessionStorage.getItem(TOKENS_KEY) || 'null');
    if (!tokens) return null;
    if (Date.now() > tokens.expiresAt - 60_000) {
      try {
        tokens = await requestTokens({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
      } catch (err) {
        console.warn(err);
        sessionStorage.removeItem(TOKENS_KEY);
        return null;
      }
    }
    return tokens.idToken;
  }

  // Claims for display only. The backend verifies the token, the client doesn't need to.
  function claims(token) {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function signOut() {
    sessionStorage.removeItem(TOKENS_KEY);
    const url = new URL('/logout', cfg.cognitoDomain);
    url.search = new URLSearchParams({ client_id: cfg.clientId, logout_uri: cfg.redirectUri });
    location.assign(url);
  }

  window.ChatAuth = { signIn, signOut, handleRedirect, getIdToken, claims };
})();
