import {chromium} from 'playwright';

// Probe the Chromium revision installed by this checkout's Playwright package.
const browser = await chromium.launch({headless: true, timeout: 15_000});
try {
  const page = await browser.newPage();
  await page.goto('data:text/html,<title>Chromium probe</title>');
  if (await page.title() !== 'Chromium probe') throw new Error('Chromium probe failed');
} finally {
  await browser.close();
}
