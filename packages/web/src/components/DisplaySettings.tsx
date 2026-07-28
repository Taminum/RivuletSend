import { useState } from "react";
import { storedCompact, applyCompact } from "../display";

// Display density toggle. One switch, applied at the document root, tightens
// every list in the app at once.
export function DisplaySettings() {
  const [compact, setCompact] = useState(storedCompact());

  function toggle() {
    const next = !compact;
    setCompact(next);
    applyCompact(next);
  }

  return (
    <div className="card">
      <div className="section-label">Display</div>
      <label className="rs-switch-row">
        <span>
          <div className="file-name">Compact lists</div>
          <div className="file-sub">Tighter rows in Contacts, History and folders.</div>
        </span>
        <button
          className={`rs-switch ${compact ? "on" : ""}`}
          role="switch"
          aria-checked={compact}
          onClick={toggle}
        >
          <span className="rs-switch-knob" />
        </button>
      </label>
    </div>
  );
}
