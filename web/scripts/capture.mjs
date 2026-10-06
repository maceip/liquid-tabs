/**
 * Capture an animated GIF of the live tab strip for the GitHub README.
 * Usage: node scripts/capture.mjs [output.gif]
 *
 * Hero sequence: tear-off detach (pill → page miniature) and re-attach settle.
 * Burst captures keep the 250ms morphs smooth.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const outGif = resolve(process.argv[2] ?? resolve(here, '..', '..', 'docs', 'compact-tab-strip.gif'));
const framesDir = join(here, '..', '.gif-frames');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

async function serveDist() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = join(dist, path.replace(/^\/+/, ''));
      if (!file.startsWith(dist)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function encodeGif(framesDir, outGif) {
  await mkdir(dirname(outGif), { recursive: true });
  const palette = join(framesDir, 'palette.png');
  const vf = 'scale=880:-1:flags=lanczos';
  await run('ffmpeg', [
    '-y', '-framerate', '14', '-i', join(framesDir, 'frame-%03d.png'),
    '-vf', `${vf},palettegen=stats_mode=diff`,
    palette,
  ]);
  await run('ffmpeg', [
    '-y', '-framerate', '14', '-i', join(framesDir, 'frame-%03d.png'),
    '-i', palette,
    '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0',
    outGif,
  ]);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const { server, origin } = await serveDist();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1100, height: 720 },
    deviceScaleFactor: 2,
  });
  await page.goto(origin, { waitUntil: 'networkidle' });

  await page.click('[data-theme-button="dark"]');
  await page.click('[data-scene="pinned"]');
  await sleep(1200);

  // Keep tear-offs local (no real popup) so the morph is the star.
  const windowToggle = page.locator('#window-detach');
  if (await windowToggle.isChecked()) await windowToggle.uncheck();

  // Wider clip than .browser so the floating page miniature is never cropped.
  const browserBox = await page.locator('.browser').boundingBox();
  const clip = {
    x: Math.max(0, browserBox.x - 8),
    y: Math.max(0, browserBox.y - 8),
    width: Math.min(1100 - Math.max(0, browserBox.x - 8), browserBox.width + 16),
    height: Math.min(720 - Math.max(0, browserBox.y - 8), browserBox.height + 24),
  };

  let frame = 0;
  let capturing = true;
  const shot = async () => {
    frame += 1;
    await page.screenshot({ path: join(framesDir, `frame-${String(frame).padStart(3, '0')}.png`), clip }).catch(() => {});
  };
  const capture = (async () => {
    while (capturing) {
      await shot();
      await sleep(70);
    }
  })();

  /** Extra dense frames during a morph (~30fps). */
  const burst = async (ms, stepMs = 32) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await shot();
      await sleep(stepMs);
    }
  };

  await sleep(200);
  const tabs = page.locator('.pie-tab');
  const count = Math.min(3, await tabs.count());

  // Quick select so the strip is live, then go straight to the tear-off hero.
  await tabs.nth(0).locator('.tab-activate').click({ force: true });
  await sleep(220);
  await shot();
  await tabs.nth(Math.min(1, count - 1)).locator('.tab-activate').click({ force: true });
  await sleep(220);
  await shot();

  // --- HERO 1: tear-off detach (pill → page miniature) + re-attach settle ---
  const tearTab = tabs.nth(Math.min(1, count - 1));
  let box = await tearTab.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Target: open content, well clear of the 36px strip so the miniature reads.
    const dropX = browserBox.x + browserBox.width * 0.40;
    const dropY = browserBox.y + browserBox.height * 0.52;

    await page.mouse.move(cx, cy);
    await sleep(100);
    await page.mouse.down();
    // Break the 4px threshold with a vertical bias so tear-off starts immediately.
    await page.mouse.move(cx + 3, cy + 14, { steps: 2 });
    await sleep(20);

    // Slow travel through the escape band — morph begins as we leave the strip.
    for (let step = 1; step <= 12; step++) {
      const t = step / 12;
      await page.mouse.move(
        cx + (dropX - cx) * t,
        cy + 14 + (dropY - cy - 14) * t,
      );
      await burst(42, 28);
    }

    // Hold the floating page miniature in open content (readable thumbnail).
    await page.mouse.move(dropX, dropY);
    await burst(500, 40);
    await page.mouse.move(dropX + 16, dropY + 12);
    await burst(320, 40);
    await shot();

    // --- HERO 1b: re-attach (miniature → pill + spring settle) ---
    for (let step = 1; step <= 12; step++) {
      const t = step / 12;
      await page.mouse.move(
        dropX + 16 + (cx - (dropX + 16)) * t,
        dropY + 12 + (cy + 20 - (dropY + 12)) * t,
      );
      await burst(42, 28);
    }
    await page.mouse.move(cx, cy + 18);
    await burst(180, 30);
    await page.mouse.up();
    // Spring settle into the home slot.
    await burst(600, 42);
  }

  // --- Horizontal reorder (slot-swap springs) ---
  box = await tabs.nth(0).boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await sleep(50);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(cx + step * 15, cy + 1);
      await sleep(40);
    }
    await burst(160, 32);
    await page.mouse.up();
    await burst(400, 42);
  }

  // --- HERO 2: tear-off + Escape cancel (detach morph, then snap-back attach) ---
  box = await tearTab.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dropX = browserBox.x + browserBox.width * 0.58;
    const dropY = browserBox.y + browserBox.height * 0.48;

    await page.mouse.move(cx, cy);
    await sleep(50);
    await page.mouse.down();
    await page.mouse.move(cx + 2, cy + 16, { steps: 2 });
    for (let step = 1; step <= 10; step++) {
      const t = step / 10;
      await page.mouse.move(cx + (dropX - cx) * t, cy + 16 + (dropY - cy - 16) * t);
      await burst(40, 28);
    }
    await burst(320, 36);
    await shot();
    await page.keyboard.press('Escape');
    await burst(650, 36);
    await page.mouse.up();
  }

  capturing = false;
  await capture;
  await browser.close();
  server.close();

  if (frame < 20) throw new Error('Not enough frames captured');
  await encodeGif(framesDir, outGif);
  console.log(`Wrote ${frame} frames → ${outGif}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
