import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiDevice } from "../api";
import { usePresence } from "../presence/PresenceContext";
import { selectionFromInputFiles } from "../folderSelect";
import { Avatar } from "./Avatar";
import { SendIcon, FolderIcon } from "../icons";

// Send files straight to one of my own paired devices (e.g. my Windows client),
// no code and no confirmation — only that the device is online. This is the
// point of pairing: fling a file to my other machine.
export function MyDevicesSend({ onManage }: { onManage?: () => void } = {}) {
  const { isDeviceOnline, sendToDevice, sendFolderToDevice, callStatus, sendWhenOnline, cancelQueued, queuedForOnline } =
    usePresence();
  const [devices, setDevices] = useState<ApiDevice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<string | null>(null);
  const whenOnlineRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const { devices } = await api.listDevices();
      setDevices(devices);
    } catch {
      /* not signed in / offline */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Other devices than this one (never send to myself).
  const others = devices.filter((d) => !d.isCurrent);

  // Sensible empty state rather than a blank/absent card.
  if (loaded && others.length === 0) {
    return (
      <div className="card">
        <div className="panel-title">Your devices</div>
        <p className="muted" style={{ margin: 0 }}>
          No devices paired yet —{" "}
          {onManage ? (
            <button className="linklike" onClick={onManage}>
              link one in Settings
            </button>
          ) : (
            "link one in Settings"
          )}
          .
        </p>
      </div>
    );
  }
  if (others.length === 0) return null; // still loading

  function pickFilesFor(deviceId: string, whenOnline = false) {
    targetRef.current = deviceId;
    whenOnlineRef.current = whenOnline;
    fileInputRef.current?.click();
  }
  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (targetRef.current && files.length) {
      if (whenOnlineRef.current) sendWhenOnline("device", targetRef.current, files);
      else sendToDevice(targetRef.current, files);
    }
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
      <div className="panel-title">Your devices</div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
        Send straight to your own paired devices — no code, no confirmation.
      </p>
      <ul className="file-list">
        {others.map((d) => {
          const deviceOnline = isDeviceOnline(d.id);
          const queued = queuedForOnline.has(d.id);
          return (
            <li key={d.id} className="file-row hoverable">
              <Avatar id={d.id} name={d.label} online={deviceOnline} />
              <span className="file-meta">
                <span className="file-name">{d.label}</span>
                <span className={`file-sub ${deviceOnline ? "online-tag" : ""}`}>
                  {d.platform ? `${d.platform} · ` : ""}
                  {queued && !deviceOnline ? "Queued — sends when online" : deviceOnline ? "Online" : "Offline"}
                </span>
              </span>
              <span className="row-actions">
                {queued && !deviceOnline ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => cancelQueued(d.id)} title="Cancel queued send">
                    Cancel
                  </button>
                ) : deviceOnline ? (
                  <>
                    <button
                      className="icon-btn"
                      disabled={callStatus === "connecting"}
                      title="Pick a folder for this device"
                      aria-label="Pick a folder"
                      onClick={() => void pickFolderFor(d.id)}
                    >
                      <FolderIcon size={16} />
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={callStatus === "connecting"}
                      title="Send files to this device"
                      onClick={() => pickFilesFor(d.id)}
                    >
                      <SendIcon size={14} /> Send
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Queue files — they'll send automatically when this device comes online"
                    onClick={() => pickFilesFor(d.id, true)}
                  >
                    <SendIcon size={14} /> Send when online
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
