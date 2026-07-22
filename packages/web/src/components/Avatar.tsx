// Flat-color circle avatar. The color is hashed from the contact id so the same
// contact always gets the same color everywhere they appear (Send list, Contacts
// page, History rows). Pass `online` to overlay a status dot; omit it for places
// where per-contact presence isn't known.
const PALETTE = [
  "#e8734a", // coral
  "#3d8bf0", // blue
  "#e8c53d", // yellow
  "#7c6df2", // iris
  "#3ed598", // mint
  "#f26db0", // rose
  "#5ad2c8", // teal
  "#b985ff", // violet
];

export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({
  id,
  name,
  online,
  size = 34,
}: {
  id: string;
  name: string;
  online?: boolean;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      style={{ background: colorForId(id), width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
      {online !== undefined && <span className={`avatar-dot ${online ? "on" : "off"}`} />}
    </span>
  );
}
