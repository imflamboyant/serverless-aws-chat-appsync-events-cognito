// Sign-in with Cognito managed login, using Amplify Auth from a CDN.
// Both imports pin the same Amplify core, so they share one Amplify instance.
import { Amplify } from 'https://esm.sh/aws-amplify@6.22.2?deps=@aws-amplify/core@6.19.3';
import { fetchAuthSession, signInWithRedirect, signOut } from 'https://esm.sh/aws-amplify@6.22.2/auth?deps=@aws-amplify/core@6.19.3';
// completes the sign-in when Cognito redirects back with ?code=...
import 'https://esm.sh/aws-amplify@6.22.2/auth/enable-oauth-listener?deps=@aws-amplify/core@6.19.3';

const cfg = window.CHAT_CONFIG;

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: cfg.userPoolId,
      userPoolClientId: cfg.clientId,
      loginWith: {
        oauth: {
          domain: new URL(cfg.cognitoDomain).host, // Amplify wants the host only
          scopes: ['openid', 'profile'],
          redirectSignIn: [cfg.redirectUri],
          redirectSignOut: [cfg.redirectUri],
          responseType: 'code',
        },
      },
    },
  },
});

// The ID token, refreshed by Amplify once it has expired. null when signed out.
// toString() gives the JWT, payload the claims.
export async function getIdToken() {
  const { tokens } = await fetchAuthSession();
  return tokens?.idToken ?? null;
}

export const signIn = () => signInWithRedirect();
export { signOut };
