import { useEffect, useRef, useState } from "react";
import { XIcon } from "../icons";

// Webcam QR scanner for joining from a laptop by pointing its camera at a QR on
// another screen. Prefers the native BarcodeDetector (Chrome/Edge — zero bundle
// cost); lazily imports jsQR only where it's missing (Firefox/Safari), so
// browsers with native support never download the fallback.
//
// Camera permission is requested only here, on open — never proactively.

// BarcodeDetector isn't in the TS DOM lib yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBarcodeDetector = any;

export function QrScannerModal({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let detector: AnyBarcodeDetector = null;
    let jsQR: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
    let canvas: HTMLCanvasElement | null = null;

    function finish(raw: string): void {
      const m = raw.match(/receive=([A-Za-z0-9]+)/);
      const code = (m ? m[1] : raw).trim().toUpperCase();
      if (code) onDetected(code);
    }

    async function scan(): Promise<void> {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) return finish(codes[0].rawValue);
          } else if (jsQR && canvas) {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w && h) {
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h);
                const res = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
                if (res?.data) return finish(res.data);
              }
            }
          }
        } catch {
          /* transient decode error — keep scanning */
        }
      }
      raf = requestAnimationFrame(() => void scan());
    }

    async function start(): Promise<void> {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        setError("Camera access was denied — you can still type the code manually.");
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const BD = (window as any).BarcodeDetector;
      if (BD) {
        try {
          detector = new BD({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      if (!detector) {
        jsQR = (await import("jsqr")).default as typeof jsQR;
        canvas = document.createElement("canvas");
      }
      void scan();
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            <div className="file-name">Scan a QR code</div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <XIcon size={18} />
          </button>
        </div>
        <div className="modal-body">
          {error ? (
            <p className="muted" style={{ textAlign: "center" }}>
              {error}
            </p>
          ) : (
            <video ref={videoRef} className="qr-video" muted playsInline />
          )}
        </div>
      </div>
    </div>
  );
}
