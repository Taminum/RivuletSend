import { useState } from "react";
import { soundsEnabled, setSoundsEnabled } from "../notifications";

// Single toggle that both plays a completion chime and shows desktop
// notifications. Off by default; requests notification permission on the click
// that turns it on (never proactively).
export function NotificationsSettings() {
  const [on, setOn] = useState(soundsEnabled());

  async function toggle() {
    const next = !on;
    setOn(next);
    await setSoundsEnabled(next);
  }

  return (
    <div className="card">
      <div className="section-label">Sounds &amp; notifications</div>
      <label className="rs-switch-row">
        <span>
          <div className="file-name">Notify me when a transfer finishes</div>
          <div className="file-sub">
            A desktop notification and a short chime on completed transfers. Asks for notification
            permission when you turn this on.
          </div>
        </span>
        <button
          className={`rs-switch ${on ? "on" : ""}`}
          role="switch"
          aria-checked={on}
          onClick={() => void toggle()}
        >
          <span className="rs-switch-knob" />
        </button>
      </label>
    </div>
  );
}
