// Rasterize the brand owl (packages/web/public/logo.svg) into the icons the
// desktop build needs: a multi-resolution Windows .ico (for the exe + installer,
// via electron-builder) and PNGs for the runtime window/tray icon. No native
// image deps — Chromium (already present via Playwright) does the rasterizing,
// and we pack the .ico container by hand (Windows accepts PNG-compressed ICO
// entries).
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, "..", "..", "web", "public", "logo.svg"), "utf8");

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = {};
try {
  for (const size of [...SIZES, 512]) {
    // Transparent page, SVG sized exactly to NxN, screenshot with alpha so the
    // rounded-rect corners stay transparent.
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">
         <div style="width:${size}px;height:${size}px">${svg.replace('width="100%"', `width="${size}" height="${size}"`)}</div>
       </body></html>`,
      { waitUntil: "networkidle" },
    );
    pngs[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
} finally {
  await browser.close();
}

// --- Pack the .ico ---
// ICONDIR (6) + ICONDIRENTRY*N (16 each) + PNG payloads appended after.
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  const payloads = [];
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0); // width (0 = 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1); // height
    dir.writeUInt8(0, b + 2); // palette
    dir.writeUInt8(0, b + 3); // reserved
    dir.writeUInt16LE(1, b + 4); // color planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, b + 8); // bytes in resource
    dir.writeUInt32LE(offset, b + 12); // offset
    offset += e.png.length;
    payloads.push(e.png);
  });
  return Buffer.concat([header, dir, ...payloads]);
}

const ico = packIco(SIZES.map((size) => ({ size, png: pngs[size] })));
const assets = join(here, "..", "assets");
writeFileSync(join(here, "icon.ico"), ico); // build/ = electron-builder buildResources
writeFileSync(join(assets, "icon.png"), pngs[512]); // packed into asar; window icon
writeFileSync(join(assets, "tray.png"), pngs[32]); // crisp tray render
console.log(`build/icon.ico (${SIZES.length} sizes, ${ico.length} bytes), assets/icon.png (512), assets/tray.png (32) written`);
