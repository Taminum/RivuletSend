import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { usePresence } from "../presence/PresenceContext";
import type { CompletedTransfer } from "../transfers";
import {
  SendIcon,
  ReceiveIcon,
  ContactsIcon,
  HistoryIcon,
  SettingsIcon,
  CollapseIcon,
  FileIcon,
  TextIcon,
} from "../icons";
import { PulseLine } from "./PulseLine";
import { SendView } from "./SendView";
import { ReceiveView } from "./ReceiveView";
import { ContactsPanel } from "./ContactsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { SettingsView } from "./SettingsView";

type View = "send" | "receive" | "contacts" | "history" | "settings";
type SendMode = "files" | "text";

const TITLES: Record<View, string> = {
  send: "Send files",
  receive: "Receive files",
  contacts: "Contacts",
  history: "History",
  settings: "Settings",
};

function Segmented({ mode, onChange }: { mode: SendMode; onChange: (m: SendMode) => void }) {
  return (
    <div className="segmented">
      <button className={`seg ${mode === "files" ? "active" : ""}`} onClick={() => onChange("files")}>
        <FileIcon size={14} /> Files
      </button>
      <button className={`seg ${mode === "text" ? "active" : ""}`} onClick={() => onChange("text")}>
        <TextIcon size={14} /> Text
      </button>
    </div>
  );
}

function PresenceStatus() {
  const { online } = usePresence();
  return (
    <div className="header-status">
      <PulseLine active={online} />
      {online ? "Online" : "Offline"}
    </div>
  );
}

export function AppShell({
  recordComplete,
  historyKey,
}: {
  recordComplete: (t: CompletedTransfer) => void;
  historyKey: number;
}) {
  const { user } = useAuth();
  const [view, setView] = useState<View>(
    /receive=/.test(window.location.hash) ? "receive" : "send",
  );
  const [collapsed, setCollapsed] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>("files");

  const navItems: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: "send", label: "Send", icon: <SendIcon size={18} /> },
    { id: "receive", label: "Receive", icon: <ReceiveIcon size={18} /> },
    ...(user
      ? ([
          { id: "contacts", label: "Contacts", icon: <ContactsIcon size={18} /> },
          { id: "history", label: "History", icon: <HistoryIcon size={18} /> },
        ] as { id: View; label: string; icon: React.ReactNode }[])
      : []),
  ];

  return (
    <div className="app">
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <div className="brand">
          <span className="logo-mark">
            <SendIcon size={16} />
          </span>
          <span className="brand-name">RivuletSend</span>
          <button className="collapse-btn" onClick={() => setCollapsed((c) => !c)} title="Toggle sidebar">
            <CollapseIcon size={18} />
          </button>
        </div>

        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => setView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <button
          className={`nav-item ${view === "settings" ? "active" : ""}`}
          onClick={() => setView("settings")}
        >
          <SettingsIcon size={18} />
          <span>Settings</span>
        </button>
      </aside>

      <main className="main">
        <header className="main-header">
          <h1>{TITLES[view]}</h1>
          {view === "send" && <Segmented mode={sendMode} onChange={setSendMode} />}
          {view === "contacts" && user && <PresenceStatus />}
        </header>
        <div className="main-body">
          {view === "send" && (
            <SendView mode={sendMode} onComplete={recordComplete} onNavigate={setView} />
          )}
          {view === "receive" && <ReceiveView onComplete={recordComplete} />}
          {view === "contacts" && <ContactsPanel />}
          {view === "history" && <HistoryPanel refreshKey={historyKey} />}
          {view === "settings" && <SettingsView />}
        </div>
      </main>
    </div>
  );
}
