import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ClerkProvider, useAuth } from "@clerk/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { PublicAccount } from "./components/PublicAccount.js";
import { App } from "./App.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import "./styles.css";

const storedTheme = (() => {
  try {
    return localStorage.getItem("boop-debug-theme");
  } catch {
    return null;
  }
})();
document.documentElement.classList.add(storedTheme === "light" ? "light" : "dark");

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  document.getElementById("root")!.innerHTML = `
    <div style="padding:2rem;font-family:system-ui">
      <h1>VITE_CONVEX_URL is not set</h1>
      <p>Run <code>npm run setup</code> or <code>npx convex dev</code> to configure Convex, then reload.</p>
    </div>`;
} else {
  const convex = new ConvexReactClient(convexUrl);
  const publicMode = import.meta.env.VITE_BOOP_PUBLIC_MODE === "true";
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        {publicMode ? clerkKey ? <ClerkProvider publishableKey={clerkKey}>
          <ConvexProviderWithClerk client={convex} useAuth={useAuth}><PublicAccount /></ConvexProviderWithClerk>
        </ClerkProvider> : <main className="public-account">Account setup is not configured yet.</main> :
          <ConvexProvider client={convex}><App /></ConvexProvider>}
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
