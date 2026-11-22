import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page.setContent(`<style>body{margin:0;background:transparent}</style>${readFileSync('build/icon.svg', 'utf8')}`);
  const png = await page.screenshot({ omitBackground: true }); writeFileSync('build/icon.png', png);
  const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  writeFileSync('build/icon.ico', Buffer.concat([header, png]));
  await page.setViewportSize({ width: 1024, height: 1024 });
  await page.addStyleTag({ content: 'svg{width:1024px;height:1024px}' });
  writeFileSync('build/icon-mac.png', await page.screenshot({ omitBackground: true }));
} finally { await browser.close(); }
