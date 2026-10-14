import { ComposioSection } from "./ComposioSection.js";
import { WhatsAppConnection } from "./WhatsAppConnection.js";

export function ConnectionsPanel({ isDark }: { isDark: boolean }) {
  return (
    <div className="h-full overflow-y-auto debug-scroll">
      {import.meta.env.VITE_BOOP_PUBLIC_MODE === "true" && <WhatsAppConnection />}
      <ComposioSection isDark={isDark} />
    </div>
  );
}
