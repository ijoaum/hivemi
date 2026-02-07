import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

// Enable dark mode
await page.emulateMediaFeatures([
  { name: 'prefers-color-scheme', value: 'dark' }
]);

await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
await page.screenshot({ path: 'docs/images/dashboard-preview.png' });
await browser.close();
console.log('Screenshot saved (dark mode)!');
