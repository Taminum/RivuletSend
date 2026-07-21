import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const exe = join(fileURLToPath(new URL("..", import.meta.url)), "dist", "win-unpacked", "Rivulet.exe");
const app = await electron.launch({ executablePath: exe });
try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.locator(".brand-name").waitFor({ timeout: 20000 });
  const brand = await win.locator(".brand-name").textContent();
  const isDesktop = await win.evaluate(() => Boolean(window.rivulet && window.rivulet.isDesktop));
  console.log("packaged exe loaded app:", brand === "RivuletSend", "| native API:", isDesktop);
  process.exitCode = brand === "RivuletSend" && isDesktop ? 0 : 1;
} finally {
  await app.close();
}
