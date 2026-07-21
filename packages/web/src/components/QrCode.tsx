import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCode({ text, size = 168 }: { text: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(text, { margin: 0, width: size, color: { dark: "#0d1016", light: "#ffffff" } })
      .then(setUrl)
      .catch(() => setUrl(null));
  }, [text, size]);

  if (!url) return null;
  return <img src={url} width={size} height={size} alt="QR code" />;
}
