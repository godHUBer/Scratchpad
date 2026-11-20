import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright';
const browser = await pw.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter(a => !a.includes('single-process') && !a.includes('no-zygote')),
         '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 260 } });
const I = (d, extra='') => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#080808" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ${extra}><path d="${d}"/></svg>`;
const icons = {
  cursor: I('M5 3l6.5 17 2.3-6.6 6.7-2.4z'),
  text:   I('M5 6h14M12 6v13M8.5 19h7'),
  brush:  I('M4 20c3.4.4 5-1.6 5.4-4L18 7.6a1.6 1.6 0 0 0 0-2.3l-1.3-1.3a1.6 1.6 0 0 0-2.3 0L5.6 12.6C3.2 13 2.6 17 4 20z'),
  eraser: I('M8 20h11M4.5 15.5l7-7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8l-4 4H9.4z'),
  hand:   I('M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15c0 3-2 5-5 5H10c-2 0-3-1-4-3l-2-3a1.6 1.6 0 0 1 2.6-1.8L8 14'),
  image:  I('M3 5h18v14H3zM3 15l5-4 4 3 3-2 6 5M15.5 9.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2'),
  audio:  I('M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2'),
  video:  I('M3 6h12v12H3zM15 10l6-3v10l-6-3'),
  book:   I('M6 3h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM6 17a2 2 0 0 0-2 2h13'),
  link:   I('M9.5 14.5a3.5 3.5 0 0 1 0-5l2.5-2.5a3.5 3.5 0 0 1 5 5L15.5 13M14.5 9.5a3.5 3.5 0 0 1 0 5L12 17a3.5 3.5 0 0 1-5-5L8.5 11'),
};
await page.setContent(`<body style="background:#ffe9b8;font-family:'Trebuchet MS',sans-serif;padding:24px">
<div style="display:flex;gap:10px;background:#fffdf6;border:3px solid #080808;border-radius:14px;padding:10px;width:max-content;box-shadow:4px 4px 0 #080808">
${Object.entries(icons).map(([k,svg]) => `<div style="display:grid;place-items:center;width:40px;height:40px;border-radius:12px;border:2px solid transparent" title="${k}">${svg}</div>`).join('')}
</div>
<div style="margin-top:10px;font-size:12px;font-weight:700">${Object.keys(icons).join(' · ')}</div></body>`);
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/icons.png' });
await browser.close();
