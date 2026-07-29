import { formatBytes } from "../format";

function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

// A tiny line chart of the last ~30s of rate samples.
function Sparkline({ data }: { data: number[] }) {
  const w = 96;
  const h = 22;
  const max = Math.max(...data, 1);
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="var(--rs-accent-soft)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Live speedometer: current rate, ETA, and a sparkline. Shows "Calculating…"
// during the first second before there's enough data for a meaningful rate.
export function TransferSpeedometer({
  rate,
  etaSeconds,
  history,
}: {
  rate: number | null;
  etaSeconds: number | null;
  history?: number[];
}) {
  return (
    <div className="card speed-card">
      {rate == null ? (
        <div className="speed-eta">Calculating…</div>
      ) : (
        <>
          <div className="speed-val">{formatBytes(rate)}/s</div>
          {history && history.length >= 2 && <Sparkline data={history} />}
          {etaSeconds != null && <div className="speed-eta">~{formatEta(etaSeconds)} left</div>}
        </>
      )}
    </div>
  );
}
