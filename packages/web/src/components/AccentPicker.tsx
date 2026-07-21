import { useState, type CSSProperties } from "react";
import { ACCENTS, ACCENT_KEYS, storedAccent, type AccentKey } from "../theme";
import { useAuth } from "../auth/AuthContext";

// Preset swatch row. Selecting one overrides --rs-accent live (no reload),
// persists to localStorage, and — when signed in — to the account.
export function AccentPicker() {
  const { setAccent } = useAuth();
  const [current, setCurrent] = useState<AccentKey>(storedAccent());

  function choose(key: AccentKey) {
    setCurrent(key);
    void setAccent(key);
  }

  return (
    <div className="card">
      <div className="section-label">Accent</div>
      <div className="swatch-row">
        {ACCENT_KEYS.map((key) => (
          <button
            key={key}
            className={`swatch ${current === key ? "active" : ""}`}
            style={{ "--sw": ACCENTS[key].accent } as CSSProperties}
            title={ACCENTS[key].label}
            aria-label={ACCENTS[key].label}
            aria-pressed={current === key}
            onClick={() => choose(key)}
          />
        ))}
      </div>
    </div>
  );
}
