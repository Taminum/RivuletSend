import { DownloadIcon } from "../icons";

// "latest/download/<fixed-name>" always resolves to the newest release's asset,
// so these links never need bumping when a new version ships (the artifact names
// are pinned in packages/desktop/package.json).
const RELEASES = "https://github.com/Taminum/RivuletSend/releases";
const INSTALLER = `${RELEASES}/latest/download/RivuletSend-Setup.exe`;
const PORTABLE = `${RELEASES}/latest/download/RivuletSend-Portable.exe`;

// Settings card offering the Windows desktop build. Hidden when the app is
// already running inside the desktop shell — no point offering a download to
// someone who's using it.
export function DesktopAppCard() {
  const isDesktop = typeof window !== "undefined" && Boolean(window.rivulet?.isDesktop);
  if (isDesktop) return null;

  return (
    <div className="card">
      <div className="panel-title">Desktop app</div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 14 }}>
        Run RivuletSend as a native Windows app — background transfers, tray icon, and auto-save to a folder.
      </p>
      <div className="download-row">
        <a className="btn btn-primary btn-sm" href={INSTALLER}>
          <DownloadIcon size={14} /> Download installer
        </a>
        <a className="btn btn-ghost btn-sm" href={PORTABLE}>
          Portable (no install)
        </a>
      </div>
      <p className="muted" style={{ marginTop: 12, fontSize: 12.5 }}>
        Windows 10/11 ·{" "}
        <a href={`${RELEASES}/latest`} target="_blank" rel="noreferrer">
          All downloads
        </a>
      </p>
    </div>
  );
}
