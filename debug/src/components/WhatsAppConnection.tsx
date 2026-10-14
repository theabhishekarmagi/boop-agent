import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/publicAuth.js";
interface Status { phone: string; connected: boolean; botStatus: string }
interface Challenge { url: string; qr: string; expiresAt: number }
export function WhatsAppConnection() {
  const [status, setStatus] = useState<Status>();
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch("/api/whatsapp/status");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Unable to check WhatsApp connection");
      setStatus(data);
      setError("");
      if (data.connected) setChallenge(undefined);
    } catch { setError("Cannot reach Boop right now. Retrying shortly…"); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => { setNow(Date.now()); void refresh(); }, 5000); return () => clearInterval(timer); }, [refresh]);
  async function action(connect: boolean) {
    setBusy(true); setError("");
    try {
      const r = await apiFetch(`/api/whatsapp/${connect ? "connect" : "disconnect"}`, { method: "POST" });
      const data = await r.json().catch(() => ({ error: "Boop is temporarily unavailable. Please try again." }));
      if (!r.ok) throw new Error(data.error || "Unable to update WhatsApp connection");
      setChallenge(connect ? data : undefined); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Connection failed"); }
    finally { setBusy(false); }
  }
  const expired = challenge && now >= challenge.expiresAt;
  return <section className="whatsapp-card">
    <div><span className="whatsapp-eyebrow">WHATSAPP</span><h2>Your agent, one message away</h2>
      <p>Connect the WhatsApp account using your verified number{status?.phone ? ` (${status.phone})` : ""}.</p></div>
    {status?.connected ? <><p className="whatsapp-success">Connected. Message Boop on WhatsApp to talk to your agent.</p>
      <button disabled={busy} onClick={() => void action(false)}>Disconnect WhatsApp</button></> : <>
      <p>Scan the QR with your camera, or open the link on your phone. Send the prefilled message to confirm the connection.</p>
      {challenge && !expired ? <div className="whatsapp-pairing"><img src={challenge.qr} alt="Scan to open your WhatsApp connection chat" width="240" height="240" />
        <a href={challenge.url} target="_blank" rel="noreferrer">Open WhatsApp</a><p>Expires in {Math.max(0, Math.ceil((challenge.expiresAt - now) / 60000))} minute(s).</p></div> :
        <button disabled={busy || status?.botStatus !== "connected"} onClick={() => void action(true)}>{busy ? "Preparing your QR…" : expired ? "Generate a fresh QR" : "Connect WhatsApp"}</button>}
      {status && status.botStatus !== "connected" && <p>Boop’s WhatsApp connection is offline. Try again shortly.</p>}
    </>}
    {error && <p role="alert">{error} <button onClick={() => { setError(""); void refresh(); }}>Retry</button></p>}
  </section>;
}
