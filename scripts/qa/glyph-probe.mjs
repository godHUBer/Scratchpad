import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter(a => !a.includes('single-process') && !a.includes('no-zygote')),
         '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  headless: true,
});
const page = await browser.newPage();
await page.setContent(`<!doctype html><body style="font-family:'Trebuchet MS',sans-serif;font-size:28px">
  <div id="a">🖱️ 🔠 🖌️ 🧽 ✋ ✍️ 🖼️ 🎧 🎬 🔖 🔗</div>
  <div id="b">▲ ◐ ■ ↔ ↗ ✓ ✕ ★ ▣ ⬚ ⌫ ✎ ❖ ⧉</div>
</body></html>`);
const probe = await page.evaluate(() => {
  const widths = (id) => [...document.getElementById(id).firstChild.textContent.trim()];
  const ctx = document.createElement('canvas').getContext('2d');
  const out = {};
  for (const id of ['a', 'b']) {
    out[id] = widths(id).map((ch) => {
      ctx.font = '28px "Trebuchet MS", sans-serif';
      const w = ctx.measureText(ch).width;
      return { ch, w: Math.round(w), notdef: w === ctx.measureText('\uFFFF').width || w === 0 };
    });
  }
  return out;
});
// which glyphs render as tofu (a single replacement width, typically 0 or == .notdef)
for (const [id, list] of Object.entries(probe)) {
  const tofu = list.filter((x) => x.notdef).map((x) => x.ch);
  console.log(id, 'total', list.length, 'tofu:', JSON.stringify(tofu.join(' ')), 'widths:', list.map(x=>x.w).join(','));
}
await page.screenshot({ path: '/tmp/glyphs.png' });
await browser.close();
