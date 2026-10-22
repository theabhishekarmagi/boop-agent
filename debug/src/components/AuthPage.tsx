import { useEffect, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
import "../auth.css";

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.5 3.83 1.5L18.7 4.6A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"
      />
    </svg>
  );
}

function Arrow() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

export function AuthPage({
  dashboardPath,
  renderDashboard,
}: {
  dashboardPath?: string;
  renderDashboard?: (signOut: () => Promise<void>, busy: boolean) => ReactNode;
}) {
  const mode = window.location.pathname === "/signup" ? "signup" : "signin";
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).has("error")
      ? "Google sign-in wasn’t completed. Please try again."
      : null,
  );
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch,
  } = authClient.useSession();
  const { isAuthenticated, isLoading: identityLoading } = useConvexAuth();
  const profile = useQuery(api.auth.currentUser, isAuthenticated ? {} : "skip");
  const ensureWorkspace = useMutation(api.workspaces.ensure);
  useEffect(() => {
    if (profile?.ownerId) void ensureWorkspace().catch(() => setActionError("We couldn’t prepare your workspace. Please reload."));
  }, [profile?.ownerId, ensureWorkspace]);
  const signedIn = Boolean(session && isAuthenticated && profile && profile.id === session.user.id);
  const loading =
    isPending ||
    (Boolean(session) &&
      (identityLoading || (isAuthenticated && profile === undefined)));
  const identityError = session && !loading && !signedIn;
  const error =
    actionError ||
    (sessionError
      ? "We couldn’t reach sign-in. Check your connection and try again."
      : null) ||
    (identityError
      ? "We couldn’t verify your session. Please sign out and try again."
      : null);

  useEffect(() => {
    document.title = signedIn
      ? renderDashboard
        ? "Dashboard · Boop"
        : "Your account · Boop"
      : `${mode === "signup" ? "Create account" : "Sign in"} · Boop`;
  }, [mode, signedIn, renderDashboard]);

  useEffect(() => {
    if (
      signedIn &&
      dashboardPath &&
      window.location.pathname !== dashboardPath
    ) {
      window.location.replace(dashboardPath);
    }
  }, [signedIn, dashboardPath]);

  async function signIn() {
    setBusy(true);
    setActionError(null);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}${dashboardPath ?? "/account"}`,
        errorCallbackURL: `${window.location.origin}/login?error=oauth`,
      });
      if (result.error) {
        setActionError(
          "Google sign-in is unavailable right now. Please try again.",
        );
        setBusy(false);
      }
    } catch {
      setActionError(
        "We couldn’t start Google sign-in. Check your connection and try again.",
      );
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setActionError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      window.location.replace("/login");
    } catch {
      setActionError("We couldn’t sign you out. Please try again.");
      setBusy(false);
    }
  }

  if (signedIn && renderDashboard) {
    return (
      <div key={profile?.ownerId} className="h-full">
        {renderDashboard(signOut, busy)}
        {actionError && (
          <div
            role="alert"
            className="fixed bottom-4 right-4 z-50 rounded-xl bg-red-950 p-4 text-white"
          >
            {actionError}
          </div>
        )}
      </div>
    );
  }

  if (signedIn && dashboardPath) {
    return (
      <main className="auth-page">
        <p role="status" className="p-8">
          Opening your dashboard…
        </p>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-label="Your Boop account">
        <img
          className="auth-mascot"
          src="/lunagotchi.png"
          alt=""
          width="200"
          height="200"
        />
        <h1 className="auth-name">Boop</h1>
        {signedIn && profile ? (
          <>
            <div className="auth-profile">
              <p>Hi, {profile.name.trim().split(/\s+/)[0] || "there"}.</p>
              <p>{profile.email}</p>
              <p>
                Your Google account is connected. Your workspace is being
                prepared.
              </p>
            </div>
            <button className="auth-google" onClick={signOut} disabled={busy}>
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </>
        ) : (
          <button
            className="auth-google"
            onClick={session ? signOut : signIn}
            disabled={loading || busy || (!session && Boolean(sessionError))}
            aria-busy={loading || busy}
          >
            {!session && <GoogleMark />}
            <span aria-live="polite">
              {loading
                ? "Checking your session…"
                : busy
                  ? session
                    ? "Signing out…"
                    : "Opening Google…"
                  : session
                    ? "Sign out and try again"
                    : "Continue with Google"}
            </span>
            <Arrow />
          </button>
        )}
        {error && (
          <div className="auth-error" role="alert">
            <p>{error}</p>
            {sessionError && (
              <button
                onClick={() => {
                  setActionError(null);
                  void refetch();
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
