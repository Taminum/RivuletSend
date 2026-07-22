import { useEffect, useState } from "react";
import type { AutoSaveConfig } from "../fileTransfer";

// Desktop-only: "Save incoming files automatically" toggle + folder. Stored by
// the Electron main process (desktop-local, not synced to the account), so this
// component reads/writes it over the native bridge rather than the API.
export function AutoSaveSettings() {
  const native = typeof window !== "undefined" ? window.rivulet : undefined;
  const [config, setConfig] = useState<AutoSaveConfig | null>(null);

  useEffect(() => {
    if (native?.autoSaveGet) void native.autoSaveGet().then(setConfig);
  }, [native]);

  // Not the desktop app (or an older shell without auto-save) — render nothing.
  if (!native?.isDesktop || !native.autoSaveGet || !config) return null;

  async function toggle() {
    if (!native?.autoSaveSet || !config) return;
    setConfig(await native.autoSaveSet({ enabled: !config.enabled }));
  }
  async function changeDir() {
    if (!native?.autoSavePickDir) return;
    setConfig(await native.autoSavePickDir());
  }

  return (
    <div className="card">
      <div className="section-label">Automatic save</div>
      <label className="rs-switch-row">
        <span>
          <div className="file-name">Save incoming files automatically</div>
          <div className="file-sub">
            Contact transfers land in the folder below with no prompt. One-time-code
            transfers still ask.
          </div>
        </span>
        <button
          className={`rs-switch ${config.enabled ? "on" : ""}`}
          role="switch"
          aria-checked={config.enabled}
          onClick={() => void toggle()}
        >
          <span className="rs-switch-knob" />
        </button>
      </label>

      {config.enabled && (
        <div className="rs-path-row">
          <span className="rs-path" title={config.dir}>
            {config.dir}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => void changeDir()}>
            Change…
          </button>
        </div>
      )}
    </div>
  );
}
