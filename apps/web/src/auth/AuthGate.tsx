import type { ReactNode } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { loginRequest } from './msalConfig';

/**
 * Gate that shows a "Sign in with Microsoft" screen until the user has an
 * authenticated MSAL session, then renders the app. Only mounted when auth is
 * enabled (see main.tsx).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const isAuthenticated = useIsAuthenticated();
  const { instance, inProgress } = useMsal();

  if (isAuthenticated) return <>{children}</>;

  const signIn = () => {
    void instance.loginRedirect(loginRequest);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.9 4.7L19 9.5l-4.1 2.9L16 18l-4-2.9L8 18l1.1-5.6L5 9.5l5.1-1.8L12 3z" />
          </svg>
        </div>
        <h1>Multi-Agent Sales Assistant</h1>
        <p>Sign in with your Microsoft work account to continue.</p>
        <button className="btn-signin" onClick={signIn} disabled={inProgress !== 'none'}>
          {inProgress !== 'none' ? 'Signing in…' : 'Sign in with Microsoft'}
        </button>
      </div>
    </div>
  );
}
