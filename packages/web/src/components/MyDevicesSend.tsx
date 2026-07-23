import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiDevice } from "../api";
import { usePresence } from "../presence/PresenceContext";
import { selectionFromInputFiles } from "../folderSelect";
import { Avatar } from "./Avatar";
import { SendIcon, FolderIcon } from "../icons";

// Send files straight to one of my own paired devices (e.g. my Windows client),
// no code and no confirmation — only that the device is online. This is the
// point of pairing: fling a file to my other machine.
export function MyDevicesSend() {
  const { isDeviceOnline, sendToDevice, sendFolderToDevice, callStatus } = usePresence();
  const [devices, setDevices] = useState<ApiDevice[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { devices } = await api.listDevices();
      setDevices(devices);
    } catch {
      /* not signed in / offline — render nothing */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Other devices than this one (never send to myself).
  const others = devices.filter((d) => !d.isCurrent);
  if (others.length === 0) return null;

  function pickFilesFor(deviceId: string) {
    targetRef.current = deviceId;
    fileInputRef.current?.click();
  }
  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (targetRef.current && files.length) sendToDevice(targetRef.current, files);
    e.target.value = "";
  }

  async function pickFolderFor(deviceId: string) {
    const native = typeof window !== "undefined" ? window.rivulet : undefined;
    if (native?.isDesktop && native.pickFolder) {
      const sel = await native.pickFolder();
      if (sel?.entries?.length) sendFolderToDevice(deviceId, sel.folderName, sel.entries);
      return;
    }
    targetRef.current = deviceId;
    folderInputRef.current?.click();
  }
  function onFolderChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    if (targetRef.current && chosen.length) {
      const sel = selectionFromInputFiles(chosen);
      sendFolderToDevice(targetRef.current, sel.folderName, sel.entries);
    }
    e.target.value = "";
  }

  return (
    <div className="card">
      <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesChosen} />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={onFolderChosen}
      />
      <div className="panel-title">My devices</div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
        Send straight to your own paired devices — no code, no confirmation.
      </p>
      <ul className="file-list">
        {others.map((d) => {
          const deviceOnline = isDeviceOnline(d.id);
          return (
            <li key={d.id} className="file-row hoverable">
              <Avatar id={d.id} name={d.label} online={deviceOnline} />
              <span className="file-meta">
                <span className="file-name">{d.label}</span>
                <span className={`file-sub ${deviceOnline ? "online-tag" : ""}`}>
                  {d.platform ? `${d.platform} · ` : ""}
                  {deviceOnline ? "Online" : "Offline"}
                </span>
              </span>
              <span className="row-actions">
                <button
                  className="icon-btn"
                  disabled={!deviceOnline || callStatus === "connecting"}
                  title={deviceOnline ? "Pick a folder for this device" : "Offline"}
                  aria-label="Pick a folder"
                  onClick={() => void pickFolderFor(d.id)}
                >
                  <FolderIcon size={16} />
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!deviceOnline || callStatus === "connecting"}
                  title={deviceOnline ? "Send files to this device" : "Offline — open RivuletSend there"}
                  onClick={() => pickFilesFor(d.id)}
                >
                  <SendIcon size={14} /> Send
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
