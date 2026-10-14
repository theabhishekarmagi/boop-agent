/** Persist successful operator greetings so reconnects don't repeat them. */
export function operatorWelcome(
  greeted: string[],
  send: (jid: string, text: string) => Promise<void>,
  save: (accounts: string[]) => Promise<void>,
) {
  let pending: Promise<void> = Promise.resolve();
  return (account: string) => {
    const attempt = pending.then(async () => {
      if (greeted.includes(account)) return;
      await send(account, "Hi 👋 Boop is connected to WhatsApp.");
      const updated = [...greeted, account].slice(-20);
      await save(updated);
      greeted.splice(0, greeted.length, ...updated);
    });
    pending = attempt.catch(() => {});
    return attempt;
  };
}
