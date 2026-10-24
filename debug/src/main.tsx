import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { AuthPage } from "./components/AuthPage.js";
import { PublicPages } from "./components/PublicPages.js";
import { authClient } from "./lib/auth-client.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import "./styles.css";

const storedTheme = (() => {
  try {
    return localStorage.getItem("boop-debug-theme");
  } catch {
    return null;
  }
})();
document.documentElement.classList.add(
  storedTheme === "light" ? "light" : "dark",
);

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const localDashboard =
  import.meta.env.VITE_ENABLE_DASHBOARD === "true" ||
  (import.meta.env.DEV &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname));
const dashboardView =
  localDashboard && window.location.pathname === "/dashboard";
const DebugApp = localDashboard
  ? React.lazy(() => import("./App.js").then(({ App }) => ({ default: App })))
  : null;
// @convex-dev/better-auth 0.12.5 types its provider client with a plugin
// instead of client options, inferring useSession().data as never with
// Better Auth 1.6.33. Keep the compatibility assertion at this boundary;
// application code retains the concrete, inferred authClient types.
const providerAuthClient = authClient as unknown as React.ComponentProps<
  typeof ConvexBetterAuthProvider
>["authClient"];

const publicPath = window.location.pathname.replace(/\/+$/, "") || "/";
const publicPage = publicPath === "/" ? "home"
  : publicPath === "/privacy" ? "privacy"
  : ["/terms", "/terms-of-service"].includes(publicPath) ? "terms" : null;

if (publicPage) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><PublicPages page={publicPage} /></React.StrictMode>,
  );
} else if (!convexUrl || !import.meta.env.VITE_CONVEX_SITE_URL) {
  document.getElementById("root")!.innerHTML = `
    <div style="padding:2rem;font-family:system-ui">
      <h1>Boop needs its connection settings</h1>
      <p>Set <code>VITE_CONVEX_URL</code> and <code>VITE_CONVEX_SITE_URL</code> in <code>.env.local</code>, then restart the frontend.</p>
    </div>`;
} else {
  const convex = new ConvexReactClient(convexUrl);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
          <ConvexBetterAuthProvider
            client={convex}
            authClient={providerAuthClient}
          >
            <AuthPage
              dashboardPath={localDashboard ? "/dashboard" : undefined}
              renderDashboard={
                dashboardView && DebugApp
                  ? (signOut, busy) => (
                      <React.Suspense fallback={<p>Loading your dashboard…</p>}>
                        <DebugApp onSignOut={signOut} signingOut={busy} />
                      </React.Suspense>
                    )
                  : undefined
              }
            />
          </ConvexBetterAuthProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
