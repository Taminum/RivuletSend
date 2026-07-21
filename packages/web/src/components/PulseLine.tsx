// The connection-status signature: an animated waveform for anything live right
// now (connected/online/in-progress), a flat dash for static (offline/idle).
export function PulseLine({ active = true }: { active?: boolean }) {
  if (!active) return <span className="pulse-dash">—</span>;
  return (
    <svg className="pulse-line" width="52" height="14" viewBox="0 0 60 16" aria-hidden="true">
      <polyline
        points="0,8 10,8 14,2 18,14 22,4 26,12 30,8 60,8"
        fill="none"
        stroke="var(--rs-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
