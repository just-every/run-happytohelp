import {chromium} from 'playwright';

// Probe the Chromium revision installed by this checkout's Playwright package.
let browser;
try {
  browser = await chromium.launch({headless: true, timeout: 15_000});
} catch (error) {
  console.error(error);
  process.exit(/EACCES|permission denied/i.test(String(error)) ? 77 : 1);
}
try {
  const page = await browser.newPage();
  await page.goto('data:text/html,<title>Chromium probe</title>');
  if (await page.title() !== 'Chromium probe') throw new Error('Chromium probe failed');
} finally {
  await browser.close();
}
