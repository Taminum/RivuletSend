import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiDevice } from "../api";
import { usePresence } from "../presence/PresenceContext";
import { Avatar } from "./Avatar";
import { SendIcon } from "../icons";

// Send files straight to one of my own paired devices (e.g. my Windows client),
// no code and no confirmation — only that the device is online. This is the
// point of pairing: fling a file to my other machine.
export function MyDevicesSend() {
  const { isDeviceOnline, sendToDevice, callStatus } = usePresence();
  const [devices, setDevices] = useState<ApiDevice[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  return (
    <div className="card">
      <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesChosen} />
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
              <button
                className="btn btn-primary btn-sm"
                disabled={!deviceOnline || callStatus === "connecting"}
                title={deviceOnline ? "Send to this device" : "Offline — open RivuletSend there"}
                onClick={() => pickFilesFor(d.id)}
              >
                <SendIcon size={14} /> Send
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
