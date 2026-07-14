import { useMsal } from '@azure/msal-react';

/** Topbar badge showing the signed-in user with a sign-out action. */
export function AuthMenu() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const name = account?.name ?? account?.username ?? 'Signed in';
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const signOut = () => {
    void instance.logoutRedirect({ account });
  };

  return (
    <div className="auth-menu">
      <span className="avatar" title={account?.username}>{initials || 'U'}</span>
      <span className="auth-name">{name}</span>
      <button className="btn-signout" onClick={signOut} title="Sign out">
        Sign out
      </button>
    </div>
  );
}
