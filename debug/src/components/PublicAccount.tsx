import { useEffect, useState } from "react";
import { SignIn, SignUp, UserButton, useAuth, useUser } from "@clerk/react";
import { useConvexAuth } from "convex/react";
import { App } from "../App.js";
import { setTokenProvider } from "../lib/publicAuth.js";

export function PublicAccount() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { getToken } = useAuth();
  const { user } = useUser();
  const [signUp, setSignUp] = useState(() => new URLSearchParams(location.search).has("signup"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setTokenProvider(() => getToken());
    setReady(true);
    return () => { setTokenProvider(); };
  }, [getToken]);
  if (isLoading || !ready) return <div className="public-account">Loading your account…</div>;
  if (!isAuthenticated) return <main className="public-account">
    <img src="/lunagotchi.png" width="72" alt="Boop" />
    <h1>Your agent, wherever you message.</h1>
    <p>Create your account with a verified phone number, then connect WhatsApp.</p>
    {signUp ? <SignUp routing="hash" signInUrl="/" forceRedirectUrl="/" /> : <SignIn routing="hash" signUpUrl="/?signup=1" forceRedirectUrl="/" />}
    <button onClick={() => setSignUp(!signUp)}>{signUp ? "Already have an account? Sign in" : "New to Boop? Create an account"}</button>
  </main>;
  const verified = user?.primaryPhoneNumber?.verification.status === "verified";
  if (!verified) return <main className="public-account">
    <h1>Verify your phone number</h1>
    <p>Open your profile and add a verified primary phone number to continue.</p>
    <UserButton />
  </main>;
  return <><div className="public-user-bar"><span>{user?.primaryPhoneNumber?.phoneNumber}</span><UserButton /></div><App /></>;
}
