import { useCallback, useRef, useState } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { PresenceProvider } from "./presence/PresenceContext";
import { AppShell } from "./components/AppShell";
import { GlobalTransfers } from "./components/GlobalTransfers";
import { api } from "./api";
import type { CompletedTransfer } from "./transfers";

function Root() {
  const { user } = useAuth();
  const [historyKey, setHistoryKey] = useState(0);
  const recordedRef = useRef<Set<string>>(new Set());
  const userRef = useRef(user);
  userRef.current = user;

  // Record finished transfers to history (signed-in users only). The sender
  // writes the row; the recipient sees it via the FK. Deduped by transfer id.
  const recordComplete = useCallback(async (t: CompletedTransfer) => {
    if (!userRef.current || recordedRef.current.has(t.id)) return;
    recordedRef.current.add(t.id);
    if (t.direction === "send") {
      try {
        await api.createTransfer({
          recipientUserId: t.counterpartUserId ?? undefined,
          fileName: t.name || "file",
          fileSize: t.size,
          status: t.status,
          failureReason: t.reason,
        });
      } catch {
        /* best-effort */
      }
    }
    setHistoryKey((k) => k + 1);
  }, []);

  return (
    <PresenceProvider onTransferComplete={recordComplete}>
      <AppShell recordComplete={recordComplete} historyKey={historyKey} />
      <GlobalTransfers />
    </PresenceProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
