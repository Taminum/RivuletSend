import { LockIcon, InfinityIcon, DeviceIcon } from "../../icons";

// Guest, pre-drop right-column panel. Pure static content — no data fetching —
// explaining why RivuletSend is trustworthy while the left column waits for a
// file.
export function TrustPanel() {
  return (
    <div className="card trust-panel">
      <div className="panel-title">Why RivuletSend</div>
      <ul className="trust-list">
        <li>
          <span className="trust-ico">
            <LockIcon size={16} />
          </span>
          <span>
            <b>End-to-end encrypted</b>
            <span className="muted">Files are encrypted peer-to-peer.</span>
          </span>
        </li>
        <li>
          <span className="trust-ico">
            <InfinityIcon size={16} />
          </span>
          <span>
            <b>No size limit</b>
            <span className="muted">Send files of any size.</span>
          </span>
        </li>
        <li>
          <span className="trust-ico">
            <DeviceIcon size={16} />
          </span>
          <span>
            <b>Device to device</b>
            <span className="muted">Your files never touch our servers.</span>
          </span>
        </li>
      </ul>
    </div>
  );
}
