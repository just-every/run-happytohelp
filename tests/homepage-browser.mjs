import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { wordGlyphs, wordHeightEm, wordStrokeWidth, wordViewBox, wordWidthEm } from '../src/ui/homepage/brand-word.ts';

// Real-browser check of the approved homepage (owner approval 2026-10-01; hero leading with "Knows what your customer needs
// before they do.", owner pick 2026-10-20).
const origin = process.env.H2H_TEST_ORIGIN;
if (!origin) throw new Error('Set H2H_TEST_ORIGIN to the real native homepage preview');
const evidence = process.env.H2H_EVIDENCE_DIR || '/tmp/h2h-homepage-browser';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`request failed: ${request.url()}`));
page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
const requested = [];
page.on('request', request => requested.push(request.url()));
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const axeViolations = async () => {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`));
};
const checks = [];
// Scrolls a page down to its foot, a step at a time, so every moment below the hero plays, and lets the last one finish.
const scrollThrough = async target => {
  const bottom = await target.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= bottom + 120; y += 120) { await target.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y); await target.waitForTimeout(60); }
  await target.waitForTimeout(2000);
};
const parseColor = value => {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
};

try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  // Content, in order. The page is the clarity pass: one idea per section, open source plainly, the free source a quiet footnote.
  await page.getByRole('heading', { level: 1, name: 'Knows what your customer needs before they do.', exact: true }).waitFor();
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('.hero-sub').innerText(), 'Some customers who get stuck never write in. They just leave.');
  assert.equal((await page.locator('.hero-free').innerText()).replace(/\s+/g, ' '), 'Open source alternative to Zendesk, Intercom, Help Scout and Freshdesk');
  assert.deepEqual(await page.locator('.hero-free strong').allInnerTexts(), ['Zendesk', 'Intercom', 'Help\u00a0Scout', 'Freshdesk'], 'the four company names are strong elements and Help Scout does not break');
  assert.deepEqual(await page.locator('.hero-free').evaluate(el => [getComputedStyle(el).fontWeight, ...[...el.querySelectorAll('strong')].map(s => getComputedStyle(s).fontWeight)]), ['400', '600', '600', '600', '600'], 'the names are bold and the lead-in is not');
  assert.equal(await page.locator('.hero-examples').count(), 0, 'the examples strip is removed');
  assert.deepEqual(await page.locator('.hero-moments li').evaluateAll(items => items.map(item => [item.querySelector('b').textContent, item.querySelector('p').textContent])), [
    ['Before they ask', 'When someone seems stuck, the widget offers a hand.'],
    ['When they ask', 'Your Codex or Claude fixes the problem and writes the reply. You press Send.'],
  ], 'the hero names its two moments, before they ask and when they ask, under the drawing');
  assert.deepEqual(await page.locator('.hero-copy .actions a').allInnerTexts(), ['Get the code', 'Read the docs'], 'the hero has two controls and no third');
  assert.deepEqual(await page.locator('main > section').evaluateAll(sections => sections.map(section => section.id)), ['top', 'free', 'product', 'move-in', 'get-started']);
  assert.deepEqual(await page.locator('main h2').allInnerTexts(), ['Yours to run and change.', 'The rest of your support desk', 'Try it beside what you have', 'Ready when you are.']);
  assert.equal(await page.locator('#product .section-head p').count(), 0, 'the Product heading has no sub-line');
  assert.deepEqual(await page.locator('.parts > li h3').allInnerTexts(), ['Chat widget', 'Shared inbox', 'Help centre', 'Suggested replies']);
  assert.deepEqual(await page.locator('.parts > li > p').allInnerTexts(), [
    'Right on your website.',
    'Chat and email, in one place.',
    'Answers customers find themselves.',
    'Drafted from your own articles, with sources.',
  ]);
  assert.equal(await page.locator('.signals').count(), 0, 'the signals list is removed');
  assert.equal(await page.locator('#free .split-copy > p:not(.free-note)').innerText(), 'HappyToHelp is open source and MIT licensed, so it’s yours to use, change and run however you like.');
  assert.equal(await page.locator('#free .split-copy > p.free-note').innerText(), 'You can also have all the source for free.');
  assert.deepEqual(await page.locator('#free .proof li').allInnerTexts(), ['No seats.', 'No plans.', 'No fees.']);
  assert.deepEqual(await page.locator('#free .actions a').allInnerTexts(), ['Get the code']);
  assert.equal(await page.locator('#move-in .split-copy > p').innerText(), 'Keep your current helpdesk running while you try it.');
  assert.deepEqual((await page.locator('#move-in .steps li').allInnerTexts()).map(text => text.replace(/\s+/g, ' ')), [
    'Install it. Codex or Claude can help.',
    'Bring your help centre. From Zendesk, Intercom or Freshdesk.',
    'Add the chat widget. One script tag on your site.',
  ]);
  assert.deepEqual(await page.locator('#move-in .steps li > b').allInnerTexts(), ['Install it.', 'Bring your help centre.', 'Add the chat widget.']);
  assert.deepEqual(await page.locator('#move-in .actions a').allInnerTexts(), ['Read the installation guide'], 'Move in has a text link and no pill');
  assert.deepEqual(await page.locator('#get-started').evaluate(section => [...section.children].map(child => child.textContent.trim())), ['Ready when you are.', 'Get the codeRead the docs'], 'the closing band is a heading and two links');
  assert.deepEqual(await page.locator('#get-started .actions a').allInnerTexts(), ['Get the code', 'Read the docs']);
  assert.equal(await page.locator('#get-started h2').evaluate(h2 => getComputedStyle(h2.closest('section')).textAlign), 'center', 'the closing band is centred');
  assert.equal(await page.locator('footer').count(), 1);
  assert.deepEqual(await page.locator('footer a').allInnerTexts(), ['HappyToHelp', 'Docs', 'GitHub', 'Workspace', 'Set up', 'Log in', 'MIT licence']);
  assert.ok(!(await page.locator('[class*="village"], [class*="parallax"]').count()), 'retired homepage markup is absent');
  // Nothing on the page, in its labels, title or description, names a price, a host, a provider or Run Edit Run.
  const pageText = await page.locator('.h2h-home').innerText();
  const labels = await page.locator('figure.drawing').evaluateAll(figures => figures.map(figure => figure.getAttribute('aria-label')).join(' '));
  const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
  assert.equal(metaDescription, 'Customer support, solved. Your Codex or Claude fixes the problem and writes the reply; you press Send. Chat widget, shared inbox, help centre and suggested replies. Open source alternative to Zendesk, Intercom, Help Scout and Freshdesk. MIT licensed.');
  const everything = `${pageText} ${labels} ${await page.title()} ${metaDescription}`.replace(/You can also have all the source for free\.|free of charge|No fees\./gi, '');
  assert.doesNotMatch(everything, /\$|£|€|\bUS\b|Cloudflare|\bhost(s|ing|ed)?\b|\bproviders?\b|run\s?edit\s?run|runeditrun|\bcosts?\b|\bfees?\b|\bpric(e|es|ed|ing)\b|\bpaid\b|\bbilling\b|invoice|Explain the change/i, 'no cost, hosting, provider, Run Edit Run or billing text anywhere on the page');
  // Truth: only Codex and Claude, never sending or deciding by themselves, no invented access levels, no percentage figure.
  assert.doesNotMatch(`${pageText} ${labels}`, /Cursor|Copilot|Gemini|Windsurf|Devin|ChatGPT|Aider|Cline|autonomous|autopilot|hands-free|no human|automatically|on its own|by itself|full access|admin access|read-write|sandbox|locked down|cloud agent|hosted agent|our agents|guaranteed|unlimited|forever/i, 'no claim the product cannot back');
  assert.deepEqual([...pageText.matchAll(/\d+\s?%[^.]*/g)].map(match => match[0].slice(0, 6)), [], 'the page states no percentage');
  assert.ok(!/sends? (it|the reply|replies) (automatically|itself)/i.test(pageText));
  checks.push('headline, subhead, open source line and the two moments\' captions; five sections in order (hero, Yours to run and change., The rest of your support desk, Try it beside what you have, Ready when you are.); exact short copy for each; no cost, hosting, provider or Run Edit Run text; no unbacked claims; footer');

  // The lockup: one link named HappyToHelp by visually hidden text, the decorative mark first, then the drawn wordmark (the
  // geometry's strokes, round-capped, in currentColor); ink in currentColor, cyan sparks.
  const brandLink = page.locator('.site-header').getByRole('link', { name: 'HappyToHelp', exact: true });
  assert.equal(await brandLink.count(), 1);
  assert.equal(await brandLink.getAttribute('href'), '#top');
  const lockup = await brandLink.evaluate(link => {
    const svg = link.querySelector('svg.brand-mark'), word = link.querySelector('svg.brand-word'), name = link.querySelector('.brand-name');
    const mark = svg.getBoundingClientRect(), box = word.getBoundingClientRect(), named = name.getBoundingClientRect(), fontSize = parseFloat(getComputedStyle(link).fontSize);
    const wordPaths = [...word.querySelectorAll('path')];
    return { svgs: link.querySelectorAll('svg').length, images: link.querySelectorAll('img, image, text').length, hidden: [svg, word].map(el => el.getAttribute('aria-hidden')), focusable: [svg, word].map(el => el.getAttribute('focusable')), tabIndex: [svg, word].map(el => el.tabIndex),
      children: [...link.childNodes].map(node => node.nodeType === 3 ? `text:${node.textContent}` : node.nodeName.toLowerCase()), name: name.textContent, nameHidden: named.width <= 1 && named.height <= 1 && getComputedStyle(name).position === 'absolute' && getComputedStyle(name).overflow === 'hidden',
      strokes: [...svg.querySelectorAll('path')].map(path => getComputedStyle(path).stroke), linkColour: getComputedStyle(link).color,
      wordStrokes: [...new Set(wordPaths.map(path => [getComputedStyle(path).stroke, getComputedStyle(path).strokeWidth, getComputedStyle(path).strokeLinecap, getComputedStyle(path).strokeLinejoin, getComputedStyle(path).fill].join(' ')))],
      wordPaths: wordPaths.map(path => [path.getAttribute('transform'), path.getAttribute('d')]), viewBox: word.getAttribute('viewBox'),
      wordBox: [+(box.width / fontSize).toFixed(3), +(box.height / fontSize).toFixed(3)], penPx: word.getScreenCTM().a * parseFloat(getComputedStyle(wordPaths[0]).strokeWidth), fontSize,
      markBeforeWord: mark.right <= box.left, capCentreOffset: Math.abs((mark.top + mark.bottom) / 2 - (box.top + box.height * (95 - 35) / 120)), scale: mark.height / fontSize };
  });
  const linkColour = lockup.linkColour;
  assert.deepEqual({ ...lockup, scale: undefined, penPx: undefined, fontSize: undefined, capCentreOffset: undefined }, {
    svgs: 2, images: 0, hidden: ['true', 'true'], focusable: ['false', 'false'], tabIndex: [-1, -1], children: ['svg', 'svg', 'span'], name: 'HappyToHelp', nameHidden: true,
    strokes: [...Array(4).fill(linkColour), ...Array(3).fill('rgb(143, 227, 238)')], linkColour: 'rgb(20, 20, 20)',
    wordStrokes: [`${linkColour} ${wordStrokeWidth}px round round none`], wordPaths: wordGlyphs.map(glyph => [`translate(${glyph.x} 0)`, glyph.d]), viewBox: wordViewBox,
    wordBox: [wordWidthEm, wordHeightEm], markBeforeWord: true, scale: undefined, penPx: undefined, fontSize: undefined, capCentreOffset: undefined }, JSON.stringify(lockup));
  assert.ok(lockup.capCentreOffset <= 0.5, `the wordmark's capitals are centred on the mark (${lockup.capCentreOffset}px)`);
  assert.ok(Math.abs(lockup.penPx - lockup.fontSize * wordHeightEm / 120 * wordStrokeWidth) <= 0.1, `the wordmark's pen is the geometry's stroke at the word's size (${lockup.penPx}px)`);
  assert.ok(lockup.scale >= 1.4 && lockup.scale <= 1.8, `the mark stands a little under three times the cap height (${lockup.scale}em)`);
  // Favicons: the SVG mark, its PNG rendering as the fallback and a home-screen icon, all served.
  const icons = await page.locator('head link[rel="icon"], head link[rel="apple-touch-icon"]').evaluateAll(links => links.map(link => [link.rel, link.type, link.getAttribute('sizes'), link.getAttribute('href')]));
  assert.deepEqual(icons, [
    ['icon', 'image/png', '512x512', '/homepage/media/brands/happytohelp-favicon.png'],
    ['icon', 'image/svg+xml', 'any', '/homepage/media/brands/happytohelp-favicon.svg'],
    ['apple-touch-icon', '', '180x180', '/homepage/media/brands/happytohelp-apple-touch-icon.png'],
  ]);
  for (const [, , , href] of icons) {
    const response = await fetch(new URL(href, origin));
    assert.equal(response.status, 200, href);
    assert.equal(response.headers.get('content-type').split(';')[0], href.endsWith('.svg') ? 'image/svg+xml' : 'image/png', href);
  }
  checks.push('the header lockup is one link named HappyToHelp by visually hidden text: an aria-hidden, unfocusable mark (ink in currentColor, three #8FE3EE sparks) before the aria-hidden, unfocusable drawn wordmark (the geometry\'s letter paths, round-capped strokes in currentColor at the geometry\'s width, capitals centred on the mark); the SVG favicon, PNG fallback and apple-touch-icon are linked and served');

  // Links derive from package.json repository.url.
  const repository = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).repository.url;
  const links = await page.locator('.h2h-home a').evaluateAll(elements => elements.map(el => ({ text: el.textContent.trim(), href: el.getAttribute('href') })));
  const allowed = ['#top', '#product', repository, '/docs', '/docs/install', `${repository}/blob/main/LICENSE`, '/projects', '/setup', '/login'];
  assert.ok(links.every(link => allowed.includes(link.href)), JSON.stringify(links));
  const hrefOf = text => links.filter(link => link.text === text).map(link => link.href);
  assert.deepEqual(hrefOf('Get the code'), [repository, repository, repository, repository], 'the pill sits in the navigation, hero, Free section and closing band');
  assert.deepEqual(hrefOf('Read the docs'), ['/docs', '/docs']);
  assert.deepEqual(hrefOf('Read the installation guide'), ['/docs/install']);
  assert.deepEqual(hrefOf('Docs'), ['/docs', '/docs'], 'the header and footer Docs links open the site\'s documentation');
  assert.equal(await page.locator('.site-header nav a', { hasText: 'Docs' }).getAttribute('aria-current'), null, 'the homepage is not the docs, so its header Docs link is not current');
  for (const href of ['/docs', '/docs/install']) {
    const response = await fetch(new URL(href, origin));
    assert.equal(response.status, 200, href);
    assert.match(response.headers.get('content-type'), /^text\/html/, href);
  }
  assert.deepEqual(hrefOf('MIT licence'), [`${repository}/blob/main/LICENSE`]);
  assert.deepEqual(hrefOf('GitHub'), [repository, repository]);
  assert.ok(!links.some(link => /runeditrun|before-you-start/i.test(`${link.text} ${link.href}`)), 'no Run Edit Run or costs link');
  for (const href of ['/projects', '/setup', '/login']) assert.ok(links.some(link => link.href === href), href);
  for (const [width, height] of [[1440, 900], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const clippedHeaderLinks = await page.locator('.site-header a').evaluateAll(links => links.filter(link => {
      const box = link.getBoundingClientRect();
      return box.width <= 0 || box.height <= 0 || box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight;
    }).map(link => link.textContent.trim()));
    assert.deepEqual(clippedHeaderLinks, [], `every header link is fully inside the viewport at ${width}px`);
    for (const link of await page.locator('.site-header a').all()) await link.click({ trial: true });
    await page.locator('.site-header nav a[href="/login"]').click();
    await page.waitForURL(url => url.pathname === '/login');
    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const form = page.locator('.id-panel form');
    await email.waitFor({ state: 'visible' });
    await password.waitFor({ state: 'visible' });
    assert.equal(await form.locator('button').evaluate(button => button.type), 'submit');
    assert.equal(await email.inputValue(), '', `email remains empty at ${width}px`);
    assert.equal(await password.inputValue(), '', `password remains empty at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  checks.push('all header links are fully visible and hittable at 320px, 390px and 1440px; following Sign in opens native /login with the email, password and submit controls visible, without entering credentials');
  checks.push('every link is the repository or its licence, the documentation at /docs (home and installation guide, both served as HTML), or a local workspace route; no Run Edit Run or costs link');

  // One open-licensed geometric sans-serif for every piece of type, actually loaded.
  const families = await page.locator('.h2h-home').evaluate(root => {
    const found = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const family = getComputedStyle(node.parentElement).fontFamily.split(',')[0].trim().replace(/["']/g, '');
      found.set(family, (found.get(family) || 0) + 1);
    }
    return [...found.entries()];
  });
  assert.deepEqual(families.map(([family]) => family), ['Outfit'], JSON.stringify(families));
  assert.ok(await page.evaluate(() => [...document.fonts].some(face => face.family.replace(/["']/g, '') === 'Outfit' && face.status === 'loaded')), 'Outfit font faces loaded');
  assert.ok(await page.evaluate(() => document.fonts.check('500 40px Outfit')));
  const fontFiles = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname).filter(path => /\.woff2$/.test(path)));
  assert.ok(fontFiles.includes('/fonts/outfit/outfit-latin-wght-normal.woff2') && fontFiles.every(path => path.startsWith('/fonts/outfit/')), `only self-hosted Outfit files are requested: ${fontFiles}`);
  const thirdParty = requested.filter(request => /^https?:/.test(request) && new URL(request).origin !== new URL(origin).origin);
  assert.deepEqual(thirdParty, [], 'the homepage makes no third-party request');
  checks.push('all type is Outfit, self-hosted from /fonts/outfit, and the page makes no third-party request');

  // Paper, ink and a monochrome page: colour inside the drawings, and outside them only aqua accents: the hero's, the sparks of the
  // header and footer mark, and below the hero the number discs, the promises' circles, the text links, the dividers and the closing line.
  assert.deepEqual(await page.locator('body').evaluate(body => [getComputedStyle(body).paddingTop, getComputedStyle(body).marginTop]), ['0px', '0px'], 'no dashboard body spacing');
  const paper = parseColor(await page.locator('.h2h-home').evaluate(el => getComputedStyle(el).backgroundColor));
  assert.deepEqual([paper.r, paper.g, paper.b], [246, 242, 234]);
  const grain = await page.locator('.h2h-home').evaluate(el => getComputedStyle(el).backgroundImage);
  assert.ok(grain.includes('feTurbulence'), 'faint paper grain');
  const coloured = await page.locator('.h2h-home').evaluate(root => {
    const found = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('.drawing')) continue;
      const style = getComputedStyle(el);
      const probes = [['color', style.color], ['background', style.backgroundColor]];
      if (parseFloat(style.borderTopWidth) > 0) probes.push(['border', style.borderTopColor]);
      if (style.textDecorationLine !== 'none') probes.push(['decoration', style.textDecorationColor]);
      if (el instanceof SVGElement) probes.push(['stroke', style.stroke]);
      for (const [name, value] of probes) {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) continue;
        const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        if (a > 0 && Math.max(r, g, b) - Math.min(r, g, b) > 14) found.push({ where: `${el.tagName.toLowerCase()}.${el.getAttribute('class') || ''} ${name}`, value, region: el.closest('.hero') ? 'hero' : el.closest('.brand-mark') ? 'mark' : el.closest('main') ? 'below' : 'chrome' });
      }
    }
    return found;
  });
  // The aqua family is the only hue: the drawings' cyan (#8FE3EE), tint (#D6F5FA) and wash (#E8F9FC), and the deep cyan (#5AD8EC) of strokes.
  const aqua = ['rgb(143, 227, 238)', 'rgb(214, 245, 250)', 'rgb(232, 249, 252)', 'rgb(90, 216, 236)'];
  assert.deepEqual(coloured.filter(probe => probe.region === 'chrome' || !aqua.includes(probe.value)), [], `outside the drawings, only the hero, the marks and the sections below the hero carry colour, and only aqua: ${JSON.stringify(coloured)}`);
  const tally = list => list.reduce((counts, key) => ({ ...counts, [key]: (counts[key] || 0) + 1 }), {});
  assert.deepEqual(tally(coloured.map(probe => `${probe.region} ${probe.where} ${probe.value}`)), {
    'mark g. stroke rgb(143, 227, 238)': 2,
    'mark path. stroke rgb(143, 227, 238)': 6,
    'hero a.text-link decoration rgb(90, 216, 236)': 1,
    'hero svg.hero-flourish color rgb(90, 216, 236)': 1,
    'hero svg.hero-flourish stroke rgb(90, 216, 236)': 1,
    'hero path. color rgb(90, 216, 236)': 1,
    'hero path. stroke rgb(90, 216, 236)': 1,
    'below span.proof-icon background rgb(214, 245, 250)': 3,
    'below div.divider color rgb(90, 216, 236)': 2,
    'below svg.divider-line divider-line--wide color rgb(90, 216, 236)': 2,
    'below svg.divider-line divider-line--wide stroke rgb(90, 216, 236)': 2,
    'below svg.divider-line divider-line--short color rgb(90, 216, 236)': 2,
    'below svg.divider-line divider-line--short stroke rgb(90, 216, 236)': 2,
    'below path. color rgb(90, 216, 236)': 5,
    'below path. stroke rgb(90, 216, 236)': 5,
    'below span.step background rgb(143, 227, 238)': 4,
    'below a.text-link decoration rgb(90, 216, 236)': 2,
    'below svg.ready-line color rgb(90, 216, 236)': 1,
    'below svg.ready-line stroke rgb(90, 216, 236)': 1,
  }, 'outside the drawings: the hero\'s docs underline and flourish; the three cyan sparks of the header and footer marks; below the hero the four filled cyan desk discs, three tinted circles behind the promises, two aqua link underlines, two dividers (a long and a short line each) and the closing line, all deep aqua strokes');
  assert.deepEqual(await page.locator('.hero-copy .text-link').evaluate(link => { const style = getComputedStyle(link); return [link.textContent, style.textDecorationLine, style.textDecorationColor, parseFloat(style.textDecorationThickness) >= 2]; }), ['Read the docs', 'underline', 'rgb(90, 216, 236)', true], '"Read the docs" has an aqua underline');
  assert.deepEqual(await page.locator('main .section .text-link').evaluateAll(links => links.map(link => { const style = getComputedStyle(link); return [link.textContent, style.textDecorationLine, style.textDecorationColor, parseFloat(style.textDecorationThickness) >= 2]; })), [['Read the installation guide', 'underline', 'rgb(90, 216, 236)', true], ['Read the docs', 'underline', 'rgb(90, 216, 236)', true]], 'the text links below the hero carry the hero\'s aqua underline');
  const filledDiscs = [
    ...await page.locator('.parts .step').evaluateAll(steps => steps.map(step => { const disc = getComputedStyle(step); return [step.textContent, disc.backgroundColor, disc.color, disc.borderTopWidth, disc.borderTopLeftRadius, disc.width === disc.height]; })),
    ...await page.locator('#move-in .steps li').evaluateAll(items => items.map((item, index) => { const disc = getComputedStyle(item, '::before'); return [String(index + 1), disc.backgroundColor, disc.color, disc.borderTopWidth, disc.borderTopLeftRadius, disc.width === disc.height]; })),
  ];
  assert.deepEqual(filledDiscs, ['1', '2', '3', '4', '1', '2', '3'].map(number => [number, 'rgb(143, 227, 238)', 'rgb(20, 20, 20)', '0px', '50%', true]), 'the desk and the three steps are numbered on filled aqua discs, as in the hero');
  assert.deepEqual(await page.locator('#free .proof li').evaluateAll(items => items.map(item => { const circle = item.firstElementChild, style = getComputedStyle(circle), icon = circle.querySelector('svg'); return [item.textContent, circle.className, style.backgroundColor, style.borderTopLeftRadius, style.width === style.height, icon.getAttribute('aria-hidden'), getComputedStyle(icon).stroke]; })), ['No seats.', 'No plans.', 'No fees.'].map(text => [text, 'proof-icon', 'rgb(214, 245, 250)', '50%', true, 'true', 'rgb(20, 20, 20)']), 'each promise has an ink line icon in a pale aqua circle');
  const discs = await page.locator('.hero-moments li').evaluateAll(items => items.map(item => { const disc = getComputedStyle(item, '::before'); return [disc.content, disc.backgroundColor, disc.color, disc.borderTopLeftRadius, disc.width === disc.height]; }));
  assert.deepEqual(discs, Array(2).fill(['counter(moment)', 'rgb(143, 227, 238)', 'rgb(20, 20, 20)', '50%', true]), 'each of the two moments\' captions has a filled aqua number disc');
  assert.deepEqual(await page.locator('.site-header').evaluate(header => [getComputedStyle(header).backgroundColor, header.querySelector('.brand').textContent, [...header.querySelectorAll('nav a')].map(a => a.textContent)]), ['rgba(0, 0, 0, 0)', 'HappyToHelp', ['Docs', 'GitHub', 'Sign in', 'Get the code']], 'the header is the plain paper with the wordmark, Docs, GitHub, Sign in and the pill');
  const cyan = await page.locator('.drawing *').evaluateAll(elements => elements.filter(el => getComputedStyle(el).backgroundColor === 'rgb(214, 245, 250)' || getComputedStyle(el).borderTopColor === 'rgb(143, 227, 238)').length);
  assert.ok(cyan >= 5, `soft cyan accents inside the drawings: the hero's fix bubble and code glyph, and three below it (${cyan})`);
  const aquaPerDrawing = await page.locator('figure.drawing:not(.story-art)').evaluateAll((figures, palette) => figures.map(figure => [...figure.querySelectorAll('*')].filter(el => {
    const style = getComputedStyle(el);
    return palette.some(colour => [style.backgroundColor, style.borderTopColor, style.color, style.stroke].includes(colour) || style.boxShadow.includes(colour) || style.backgroundImage.includes(colour)) && el.getBoundingClientRect().width > 0;
  }).length), aqua);
  assert.ok(aquaPerDrawing.length === 6 && aquaPerDrawing.every(count => count > 0), `every drawing below the hero carries an accent from the aqua palette: ${aquaPerDrawing}`);
  // The drawings below the hero, as they rest once each has played.
  await scrollThrough(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  // Each drawing below the hero floats on its own pale aqua blob, which fills its figure (the figure's padding is the room it
  // shows in) and sits behind the drawing; in a row of desk cards it reaches a little past the figure into the gaps.
  const blobs = await page.locator('figure.drawing:not(.story-art)').evaluateAll(figures => figures.map(figure => {
    // Its layout box, before any transform (a waiting moment holds its blob a little shrunk), against the figure's.
    const blob = figure.querySelector(':scope > svg.d-blob'), style = getComputedStyle(blob), [left, top, width, height] = [style.left, style.top, style.width, style.height].map(parseFloat);
    return { first: figure.firstElementChild === blob, hidden: blob.getAttribute('aria-hidden'), fill: style.fill, behind: style.zIndex === '-1' && style.position === 'absolute' && getComputedStyle(figure).isolation === 'isolate',
      covers: left <= 0.5 && top <= 0.5 && left + width >= figure.clientWidth - 0.5 && top + height >= figure.clientHeight - 0.5 && width <= figure.clientWidth * 1.15 };
  }));
  assert.deepEqual(blobs, Array(6).fill({ first: true, hidden: 'true', fill: 'rgb(232, 249, 252)', behind: true, covers: true }), `every drawing below the hero sits on a pale aqua blob: ${JSON.stringify(blobs)}`);
  assert.deepEqual(await page.locator('figure.drawing:not(.story-art) .d-blob').evaluateAll(blobs => blobs.map(blob => blob.getAttribute('class'))), ['d-blob d-blob--left', 'd-blob d-blob--left', 'd-blob d-blob--right', 'd-blob d-blob--pebble', 'd-blob d-blob--long', 'd-blob d-blob--pebble'], 'each drawing keeps its own blob');
  // Frames kept and dropped: a window frame (ink border and a bar of three ink dots) stays only where it helps: the code editor
  // under the licence card and the import page. The desk cards and the licence itself are frameless ink cards.
  const frames = await page.locator('figure.drawing:not(.story-art)').evaluateAll(figures => figures.map(figure => ({
    windows: [...figure.querySelectorAll('.d-window')].map(win => { const bar = win.querySelector(':scope > .d-bar'); return [win.classList[1] || '', bar ? bar.querySelectorAll('i').length : 0, getComputedStyle(win).borderTopColor, parseFloat(getComputedStyle(win).borderTopWidth) >= 2, bar ? getComputedStyle(bar.querySelector('i')).borderTopColor : null]; }),
    cards: [...figure.querySelectorAll('.d-card')].map(card => [card.classList[1], getComputedStyle(card).borderTopColor, parseFloat(getComputedStyle(card).borderTopWidth) >= 2, getComputedStyle(card).backgroundColor, getComputedStyle(card).boxShadow.startsWith('rgba(20, 20, 20, 0.55) 1px 1.5px'), card.querySelectorAll('.d-bar').length]),
  })));
  const ink = 'rgb(20, 20, 20)';
  assert.deepEqual(frames, [
    { windows: [['licence-editor', 3, ink, true, ink]], cards: [['licence-card', ink, true, 'rgb(255, 255, 255)', true, 0]] },
    { windows: [], cards: [['chat-art', ink, true, 'rgb(255, 255, 255)', true, 0]] },
    { windows: [], cards: [['inbox-art', ink, true, 'rgb(255, 255, 255)', true, 0]] },
    { windows: [], cards: [['help-art', ink, true, 'rgb(255, 255, 255)', true, 0]] },
    { windows: [], cards: [['sr-panel', ink, true, 'rgb(255, 255, 255)', true, 0]] },
    { windows: [['import-window', 3, ink, true, ink]], cards: [] },
  ], `frames kept (editor, import) and dropped (licence card and the four desk cards are frameless ink cards): ${JSON.stringify(frames)}`);
  const licenceStack = await page.locator('.licence-art').evaluate(art => { const editor = art.querySelector('.licence-editor').getBoundingClientRect(), card = art.querySelector('.licence-card').getBoundingClientRect(); return { cardOverEditor: card.top < editor.bottom - 20 && card.left > editor.left && card.right > editor.right && card.left < editor.right, codeRows: art.querySelectorAll('.code-line').length, aquaRuns: art.querySelectorAll('.code-run.is-aqua').length, editorText: art.querySelector('.licence-editor').textContent.trim() }; });
  assert.deepEqual(licenceStack, { cardOverEditor: true, codeRows: 7, aquaRuns: 8, editorText: '' }, `the licence card lies over the lower right of a wordless code editor: ${JSON.stringify(licenceStack)}`);
  assert.deepEqual(await page.locator('.licence-art .d-sweep').evaluateAll(marks => marks.map(mark => [mark.textContent, getComputedStyle(mark).backgroundImage, getComputedStyle(mark).backgroundSize])), [['free of charge', 'linear-gradient(rgb(143, 227, 238), rgb(143, 227, 238))', '100% 100%'], ['use, copy, modify, merge, publish, distribute', 'linear-gradient(rgb(214, 245, 250), rgb(214, 245, 250))', '100% 100%']], '"free of charge" and the rights carry full aqua highlights');
  // Sparks: the logo's three aqua sparks, the same paths as the mark, on the cards of four drawings.
  const markSparks = await page.locator('.site-header .brand-mark g:last-child path').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  assert.deepEqual(await page.locator('figure.drawing:not(.story-art)').evaluateAll(figures => figures.map(figure => figure.querySelectorAll('.d-sparks').length)), [1, 1, 0, 1, 0, 1], 'sparks on the licence card, the chat widget, the help centre and the import window');
  const sparks = await page.locator('.d-sparks').evaluateAll(list => list.map(svg => ({ paths: [...svg.querySelectorAll('path')].map(path => path.getAttribute('d')), stroke: getComputedStyle(svg.querySelector('path')).stroke, hidden: svg.getAttribute('aria-hidden'), frame: svg.parentElement.matches('.d-card, .d-window') })));
  assert.deepEqual(sparks, Array(4).fill({ paths: markSparks, stroke: 'rgb(90, 216, 236)', hidden: 'true', frame: true }), 'each set of sparks is the mark\'s three, in deep aqua, decorative, seated on a card or window');
  // Dividers: two full-width aqua pen lines that draw different squiggles, between Free and the desk, and between the desk and Try it.
  const dividers = await page.locator('main > .divider').evaluateAll(list => list.map(divider => { const shown = [...divider.querySelectorAll('svg')].filter(svg => svg.getBoundingClientRect().width > 0), main = document.querySelector('main'), inner = main.getBoundingClientRect().width - parseFloat(getComputedStyle(main).paddingLeft) - parseFloat(getComputedStyle(main).paddingRight); return { between: [divider.previousElementSibling.id, divider.nextElementSibling.id], hidden: divider.getAttribute('aria-hidden'), shown: shown.length, fullWidth: Math.abs(shown[0].getBoundingClientRect().width - inner) <= 1, paths: divider.querySelectorAll('path').length }; }));
  assert.deepEqual(dividers, [{ between: ['free', 'product'], hidden: 'true', shown: 1, fullWidth: true, paths: 2 }, { between: ['product', 'move-in'], hidden: 'true', shown: 1, fullWidth: true, paths: 2 }], `two full-width dividers: ${JSON.stringify(dividers)}`);
  // The closing band: a big headline with an aqua line under it, centred.
  const closing = await page.locator('#get-started h2').evaluate(h2 => { const line = h2.querySelector('svg.ready-line'), range = document.createRange(); range.selectNodeContents(h2.firstChild); const text = range.getBoundingClientRect(), l = line.getBoundingClientRect(); return { weight: getComputedStyle(h2).fontWeight, hidden: line.getAttribute('aria-hidden'), stroke: getComputedStyle(line.querySelector('path')).stroke, under: l.top >= text.bottom - text.height * 0.2, centred: Math.abs((l.left + l.right) / 2 - (text.left + text.right) / 2) <= 4, spans: l.width >= text.width * 0.85 && l.width <= text.width * 1.15 }; });
  assert.deepEqual(closing, { weight: '600', hidden: 'true', stroke: 'rgb(90, 216, 236)', under: true, centred: true, spans: true }, `"Ready when you are." has an aqua line drawn under it: ${JSON.stringify(closing)}`);
  // The footer signs off with the header's lockup.
  const lockups = await page.locator('.site-header .brand, .site-footer .brand').evaluateAll(brands => brands.map(brand => ({ children: [...brand.childNodes].map(node => node.nodeType === 3 ? `text:${node.textContent}` : node.nodeName.toLowerCase()), mark: brand.querySelector('svg.brand-mark').outerHTML, word: brand.querySelector('svg.brand-word').outerHTML, hidden: [...brand.querySelectorAll('svg')].map(svg => svg.getAttribute('aria-hidden')), name: brand.querySelector('.brand-name').textContent, size: getComputedStyle(brand).fontSize, markHeight: brand.querySelector('svg.brand-mark').getBoundingClientRect().height, wordBox: [brand.querySelector('svg.brand-word').getBoundingClientRect().width, brand.querySelector('svg.brand-word').getBoundingClientRect().height], penWidth: getComputedStyle(brand.querySelector('svg.brand-word path')).strokeWidth, display: getComputedStyle(brand).display })));
  assert.deepEqual(lockups[1], lockups[0], `the footer lockup is the header's: the mark, then the drawn wordmark, at the same size: ${JSON.stringify(lockups)}`);
  assert.deepEqual([lockups[1].children, lockups[1].hidden, lockups[1].name, lockups[1].penWidth], [['svg', 'svg', 'span'], ['true', 'true'], 'HappyToHelp', `${wordStrokeWidth}px`]);
  assert.equal(await page.locator('.site-footer').getByRole('link', { name: 'HappyToHelp', exact: true }).count(), 1, 'the footer lockup is one link named HappyToHelp');
  assert.deepEqual(await page.locator('.story-art').evaluate(art => [getComputedStyle(art.querySelector('.story-blob')).fill, getComputedStyle(art.querySelector('.story-bubble--fix')).backgroundColor, getComputedStyle(art.querySelector('.story-glyph')).backgroundColor, ...[...art.querySelectorAll('.story-number')].map(n => getComputedStyle(n).backgroundColor)]), ['rgb(232, 249, 252)', 'rgb(214, 245, 250)', 'rgb(214, 245, 250)', 'rgb(143, 227, 238)', 'rgb(143, 227, 238)'], 'the hero drawing is a pale aqua blob with an aqua-tinted fix bubble and code glyph, its two moments numbered on filled aqua discs');
  const buttons = await page.locator('.pill--ink').evaluateAll(els => els.map(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color, getComputedStyle(el).borderTopLeftRadius]));
  assert.ok(buttons.length === 4 && buttons.every(([bg, fg, radius]) => bg === 'rgb(20, 20, 20)' && fg === 'rgb(255, 255, 255)' && parseFloat(radius) >= 20), JSON.stringify(buttons));
  checks.push('warm paper with grain, near-black ink, black pill buttons, a plain header, and no colour outside the drawings but aqua: the hero\'s discs, docs underline and flourish, the marks\' sparks, and below the hero filled number discs, the promises\' circles, aqua link underlines, two dividers and the closing line');
  checks.push('below the hero: every drawing on its own pale aqua blob; window frames kept only for the code editor and import, frameless ink cards for the licence and the four desk parts; the licence card over a wordless editor with both highlights; the mark\'s three sparks on four cards; two full-width dividers; the closing headline in semibold with its aqua line centred under it; and the footer lockup identical to the header\'s');

  // Drawings: real DOM text, one accessible label each, no raster images, legible at every width.
  assert.equal(await page.locator('img').count(), 0);
  const drawings = await page.locator('figure.drawing').evaluateAll(figures => figures.map(figure => ({ role: figure.getAttribute('role'), label: figure.getAttribute('aria-label') })));
  assert.equal(drawings.length, 7);
  assert.ok(drawings.every(drawing => drawing.role === 'img' && drawing.label.length > 40), JSON.stringify(drawings));
  assert.equal(await page.locator('.story-art').getAttribute('aria-label'), 'Drawing of two moments. One, before they ask: on a checkout page the chat widget asks: Looks like you might be stuck. Would you like a hand with checkout? with Yes please and No thanks. Two, when they ask: Maya can’t turn on the Spanish version of her store. The agent fixes it: Spanish is live on her store. The reply to Maya is ready, and the next step is to press Send.');
  assert.equal(await page.locator('.licence-art').getAttribute('aria-label'), 'Drawing of the MIT licence: permission is granted, free of charge, to use, copy, modify, merge, publish and distribute HappyToHelp.');
  assert.equal(await page.locator('.import-art').getAttribute('aria-label'), 'Drawing of the help-centre import from Zendesk, complete with 128 articles and 9 categories.');
  assert.deepEqual(await page.locator('.parts figure.drawing').evaluateAll(figures => figures.map(figure => figure.getAttribute('aria-label'))), [
    'Drawing of the chat widget: a customer asks how to add their team and Casey answers.',
    'Drawing of the shared inbox with three conversations.',
    'Drawing of a help centre with a search field and three articles.',
    'Drawing of a suggested reply drafted from the Languages guide, with its source.',
  ]);
  assert.ok(await page.locator('.drawing .d-icon').evaluateAll(icons => icons.every(icon => icon.getAttribute('aria-hidden') === 'true')));
  assert.equal(await page.locator('.drawing a, .drawing button, .drawing input').count(), 0, 'drawn controls are not interactive');
  const wordsIn = text => text.split(/\s+/).filter(word => /[A-Za-z0-9]/.test(word)).length;
  const textOf = async selector => (await page.locator(selector).innerText()).replace(/\s+/g, ' ');
  // The hero drawing: both moments in one picture. 1, the checkout with the widget's offer card floating over its corner, signed
  // with the header's mark; 2, Maya's conversation, solved, with Send the one step left; numbered as the captions are.
  const moments = await page.locator('.story-art').evaluate(art => [...art.querySelectorAll('.story-moment')].map(moment => {
    const strings = [];
    const walker = document.createTreeWalker(moment, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue.trim()) strings.push(node.nodeValue.trim());
    return strings;
  }));
  assert.deepEqual(moments, [
    ['Checkout', 'Pay now', 'Looks like you might be stuck. Would you like a hand with checkout?', 'Yes please', 'No thanks', '1'],
    ['Maya', 'I can’t turn on the Spanish version of my store.', 'Fixed. Spanish is live on Maya’s store.', 'All done, Maya. Refresh and it’s there.', 'Send', '2'],
  ], 'the hero drawing shows exactly the two moments\' strings, each numbered');
  const story = await page.locator('.story-art').evaluate(art => {
    const offer = art.querySelector('.story-offer'), checkout = art.querySelector('.story-checkout').getBoundingClientRect(), card = offer.getBoundingClientRect();
    const composer = art.querySelector('.story-composer').getBoundingClientRect(), send = art.querySelector('.story-send').getBoundingClientRect();
    return { offerOutsideWindow: !offer.closest('.d-window'), offerOverWindow: card.left < checkout.right && card.right > checkout.right && card.top < checkout.bottom,
      sameMark: offer.querySelector('svg.brand-mark').innerHTML === document.querySelector('.site-header .brand-mark').innerHTML,
      sendInReply: send.left >= composer.left && send.right <= composer.right && send.top >= composer.top && send.bottom <= composer.bottom,
      solid: [...art.querySelectorAll('.d-btn--ink')].map(button => button.textContent), arrow: [art.querySelector('.story-arrow').getAttribute('aria-hidden'), getComputedStyle(art.querySelector('.story-arrow path')).stroke] };
  });
  assert.deepEqual(story, { offerOutsideWindow: true, offerOverWindow: true, sameMark: true, sendInReply: true, solid: ['Yes please', 'Send'], arrow: ['true', 'rgb(90, 216, 236)'] }, `the offer floats over the checkout's lower right corner, Send sits inside the reply, an aqua arrow joins the moments: ${JSON.stringify(story)}`);
  // The licence card: the real LICENSE file, drawn.
  const licenceText = await textOf('.licence-art');
  assert.equal(licenceText, 'MIT License Permission is hereby granted, free of charge, use, copy, modify, merge, publish, distribute');
  assert.equal(await page.locator('.licence-art .licence-mark').innerText(), 'free of charge');
  assert.equal(wordsIn(licenceText), 15);
  // The product drawings and the import.
  assert.equal((await page.locator('.parts .product-art').nth(0).innerText()).replace(/\s+/g, ' '), 'C Casey How do I add my team? Go to Settings and choose Invite. Message...');
  assert.equal((await page.locator('.parts .product-art').nth(1).innerText()).replace(/\s+/g, ' '), 'Inbox M Maya Chen Can’t turn on Spanish T Tom Reyes The widget isn’t loading P Priya Shah Where do I change my logo?');
  assert.equal((await page.locator('.parts .product-art').nth(2).innerText()).replace(/\s+/g, ' '), 'Search the Help Center Turn on another language Reset your password Invite team members');
  assert.equal((await page.locator('.reply-art').innerText()).replace(/\s+/g, ' '), 'Suggestions Add a language in Store settings › Languages, then publish it. Source: Languages guide');
  assert.equal(await page.locator('.parts .inbox-list li').count(), 3);
  assert.equal(await page.locator('.parts .help-art li').count(), 3);
  const importText = await textOf('.import-art');
  assert.equal(importText, 'Import articles from Zendesk Import progress complete Articles: 128 · Categories: 9');
  assert.equal(await page.locator('.import-art .d-check').count(), 1, 'the cyan check marks only the finished import');
  assert.equal(await page.locator('.import-art input, .import-art .d-btn').count(), 0, 'the finished import takes no input');
  checks.push('seven labelled drawings built from real text (the hero\'s two numbered moments: the checkout with the offer card over its corner signed with the mark, and Maya\'s solved conversation with Send inside the reply, joined by an aqua arrow; MIT licence card, widget, inbox, Help Center, suggestion, finished import), no raster images, no controls');

  // Layout at every width: no overflow, two-line headline on wide screens, legible drawings, nothing clipped.
  const markOffsets = new Map(); // each set of sparks' size at the first width, to hold every other width to it
  for (const width of [320, 390, 480, 641, 700, 723, 768, 860, 861, 959, 1100, 1200, 1280, 1366, 1440, 1680, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const metrics = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(metrics.scroll <= metrics.client, `horizontal overflow at ${width}: ${JSON.stringify(metrics)}`);
    const fontSize = await page.locator('h1').evaluate(h1 => parseFloat(getComputedStyle(h1).fontSize));
    assert.ok(fontSize >= 40, `headline size ${fontSize} at ${width}`);
    const outside = await page.locator('.drawing').evaluateAll((figures, viewport) => figures.flatMap(figure => [...figure.querySelectorAll('*')].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && (rect.right > viewport + 1 || rect.left < -1);
    }).map(el => `${el.tagName}.${el.getAttribute('class')}`)), metrics.client);
    assert.deepEqual(outside, [], `drawing parts outside the viewport at ${width}px`);
    const tiny = await page.locator('.drawing').evaluateAll(figures => figures.flatMap(figure => [...figure.querySelectorAll('*')].filter(el => {
      const rect = el.getBoundingClientRect();
      const hasText = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
      return hasText && rect.width > 0 && rect.height > 0 && parseFloat(getComputedStyle(el).fontSize) < 12;
    }).map(el => `${el.className} ${getComputedStyle(el).fontSize} ${el.textContent.trim().slice(0, 24)}`)));
    assert.deepEqual(tiny, [], `drawing text under 12px at ${width}px`);
    const header = await page.locator('.site-header').evaluate(header => {
      const brand = header.querySelector('.brand'), box = brand.getBoundingClientRect(), mark = brand.querySelector('svg.brand-mark').getBoundingClientRect(), word = brand.querySelector('svg.brand-word').getBoundingClientRect();
      const nav = [...header.querySelectorAll('nav a')].map(a => a.getBoundingClientRect());
      return { wordBesideMark: word.left >= mark.right && word.top < mark.bottom && word.bottom > mark.top && word.left >= box.left - 0.5 && word.right <= box.right + 0.5, markInside: mark.left >= box.left - 0.5 && mark.right <= box.right + 0.5, clearOfNav: nav.every(a => a.left >= box.right || a.top >= box.bottom || a.bottom <= box.top), onScreen: box.left >= 0 && box.right <= innerWidth };
    });
    assert.deepEqual(header, { wordBesideMark: true, markInside: true, clearOfNav: true, onScreen: true }, `the lockup stays on one line, clear of the navigation, at ${width}px`);
    const buttonsOk = await page.locator('.pill').evaluateAll(els => els.filter(el => el.getBoundingClientRect().width > 0).every(el => el.getBoundingClientRect().height >= 40));
    assert.ok(buttonsOk, `pill targets at ${width}px`);
    if (width <= 390) {
      const fold = await page.evaluate(() => ({ h1: document.querySelector('h1').getBoundingClientRect().bottom, cta: document.querySelector('.hero .pill').getBoundingClientRect().bottom }));
      assert.ok(fold.h1 < 844 && fold.cta < 844, `headline and Get the code above the fold at ${width}px: ${JSON.stringify(fold)}`);
    }
    // The hero drawing: every part inside its figure; wide, the two moments side by side (the conversation right of the checkout),
    // stacked once the stage is narrow; the captions under the drawing.
    const hero = await page.evaluate(() => {
      const art = document.querySelector('.story-art'), box = art.getBoundingClientRect();
      const parts = [...art.querySelectorAll('.story *')].filter(el => el.getBoundingClientRect().width > 0);
      const [before, when] = [...art.querySelectorAll('.story-moment')].map(el => el.getBoundingClientRect());
      return { art: { top: box.top, bottom: box.bottom }, outside: parts.filter(el => { const r = el.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5; }).map(el => el.getAttribute('class')),
        sideBySide: when.left >= before.right, stacked: when.top >= before.bottom, captionsUnder: document.querySelector('.hero-moments').getBoundingClientRect().top >= box.bottom };
    });
    // The logo's sparks are seated on their own card, the same way at every width.
    const seating = await page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      // Measured flat: the licence card's tilt would otherwise move its corner by a few pixels.
      const flat = document.createElement('style');
      flat.textContent = '.licence-card { transform: none !important; }';
      document.head.appendChild(flat);
      // Each stroke is sampled along its centre line, through the element's screen matrix. The corner is the card's top-right
      // border-box corner; a stroke's inner end is its end nearest that corner, and the sparks' origin is the mean of them.
      const marks = [...document.querySelectorAll('figure.drawing .d-sparks')].map(mark => {
        const figure = mark.closest('figure'), frame = rect(mark.parentElement), box = rect(figure);
        const corner = [frame.right, frame.top];
        const unit = mark.getScreenCTM().a;
        const strokes = [...mark.querySelectorAll('path')].map(path => {
          const matrix = path.getScreenCTM(), total = path.getTotalLength();
          return Array.from({ length: 121 }, (_, i) => { const p = path.getPointAtLength((total * i) / 120); return [matrix.a * p.x + matrix.c * p.y + matrix.e, matrix.b * p.x + matrix.d * p.y + matrix.f]; });
        });
        const half = (parseFloat(getComputedStyle(mark.querySelector('path')).strokeWidth) * unit) / 2;
        const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const ends = strokes.map(points => [points[0], points[points.length - 1]].sort((a, b) => near(a, corner) - near(b, corner)));
        const origin = [ends.reduce((sum, [p]) => sum + p[0], 0) / ends.length, ends.reduce((sum, [p]) => sum + p[1], 0) / ends.length];
        const all = strokes.flat();
        const ink = { left: Math.min(...all.map(p => p[0])) - half, right: Math.max(...all.map(p => p[0])) + half, top: Math.min(...all.map(p => p[1])) - half, bottom: Math.max(...all.map(p => p[1])) + half };
        // Distance from the ink (less half the stroke) to the card rectangle; negative means inside it.
        const clearance = Math.min(...all.map(p => { const out = [frame.left - p[0], p[0] - frame.right, frame.top - p[1], p[1] - frame.bottom]; const dx = Math.max(out[0], out[1], 0), dy = Math.max(out[2], out[3], 0); return (dx || dy ? Math.hypot(dx, dy) : Math.max(...out)) - half; }));
        const degrees = ends.map(([inner, outer]) => (Math.atan2(inner[1] - outer[1], outer[0] - inner[0]) * 180) / Math.PI);
        return { name: figure.getAttribute('aria-label').slice(0, 28), unit, size: Math.max(ink.right - ink.left, ink.bottom - ink.top),
          dx: (origin[0] - corner[0]) / unit, dy: (corner[1] - origin[1]) / unit, left: ink.left - corner[0], clearance, degrees,
          inFigure: ink.left >= box.left && ink.right <= box.right + 0.5 && ink.top >= box.top - 8 * unit, onScreen: ink.right <= document.documentElement.clientWidth };
      });
      flat.remove();
      // Every text line outside the drawings (headings, numerals, captions), as one rect per rendered line.
      const lines = [];
      const walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue.trim() || node.parentElement.closest('figure.drawing')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width && r.height) lines.push({ text: node.nodeValue.trim().slice(0, 28), left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
      const onText = [...document.querySelectorAll('figure.drawing .d-sparks')].flatMap(mark => {
        const m = rect(mark);
        return lines.filter(t => t.left < m.right + 2 && t.right > m.left - 2 && t.top < m.bottom + 2 && t.bottom > m.top - 2).map(t => t.text);
      });
      // The flourish against every text line and control on the page.
      const flourish = rect(document.querySelector('.hero-flourish'));
      const controls = [...document.querySelectorAll('main a, main button')].map(rect).filter(r => r.width && r.height);
      const underFlourish = [...lines, ...controls].filter(t => t.left < flourish.right && t.right > flourish.left && t.top < flourish.bottom && t.bottom > flourish.top).map(t => t.text || 'control');
      return { marks, onText, underFlourish, flourish };
    });
    assert.equal(seating.marks.length, 4, `four sets of sparks at ${width}px`);
    // Each set of sparks springs from its card's top-right corner as the mark's do from the bubble's shoulder: the strokes' inner
    // ends gather on an origin 11.5 units right of and 11.3 units above the corner (the mark's own geometry, to half a pixel),
    // the strokes head up, up-right and right, the ink lies right of the corner and clear of the card, inside the figure and the
    // screen, and every set keeps its size and offset at every width.
    for (const mark of seating.marks) {
      const where = `${mark.name} at ${width}px: ${JSON.stringify(mark)}`;
      assert.ok(Math.abs(mark.dx - 11.47) * mark.unit <= 0.5 && Math.abs(mark.dy - 11.33) * mark.unit <= 0.5, `the sparks' origin sits on the mark's offset from the corner, ${where}`);
      assert.equal(mark.degrees.length, 3, `three sparks, ${where}`);
      assert.ok(mark.degrees[0] > 55 && mark.degrees[0] < 80 && mark.degrees[1] > 25 && mark.degrees[1] < 45 && mark.degrees[2] > -15 && mark.degrees[2] < 0, `the sparks head up, up-right and right, ${where}`);
      assert.ok(mark.left >= 0, `the sparks' ink lies right of the corner, ${where}`);
      assert.ok(mark.clearance >= 2, `no spark comes within 2px of its card, ${where}`);
      assert.ok(mark.inFigure && mark.onScreen, `the sparks stay inside their figure and on screen, ${where}`);
      assert.ok(mark.size >= 30, `a set of sparks is at least 30px, ${where}`);
      const first = markOffsets.get(mark.name) || markOffsets.set(mark.name, { unit: mark.unit, size: mark.size }).get(mark.name);
      assert.ok(Math.abs(mark.size - first.size) <= 1, `a set of sparks keeps its size at every width, ${where} against ${JSON.stringify(first)}`);
    }
    assert.deepEqual(seating.onText, [], `no sparks touch a heading, numeral or caption at ${width}px`);
    // The flourish touches no text and no control, and has its full aspect-ratio box.
    assert.deepEqual(seating.underFlourish, [], `the flourish overlaps no text or control at ${width}px`);
    assert.ok(seating.flourish.height > 0 && Math.abs(seating.flourish.width / seating.flourish.height - 640 / 150) < 0.05, `the flourish keeps its 640:150 box at ${width}px: ${JSON.stringify(seating.flourish)}`);
    // The lockup's left edge (the mark's visible ink: its leftmost path, less half its stroke) lines up with the headline's
    // (the first letter's ink: the text box less the glyph's left bearing) at desktop widths.
    if (width >= 861) {
      const edges = await page.evaluate(() => {
        const mark = Math.min(...[...document.querySelectorAll('.site-header .brand svg path')].map(path => { const box = path.getBBox(), matrix = path.getScreenCTM(); return matrix.a * (box.x - parseFloat(getComputedStyle(path).strokeWidth) / 2) + matrix.e; }));
        const line = document.querySelector('#hero-title'), range = document.createRange(), style = getComputedStyle(line), context = document.createElement('canvas').getContext('2d');
        range.selectNodeContents(line);
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return [mark, range.getClientRects()[0].left - context.measureText(line.textContent[0]).actualBoundingBoxLeft];
      });
      assert.ok(Math.abs(edges[0] - edges[1]) <= 2, `the lockup and the headline share a left edge at ${width}px: ${edges}`);
    }
    assert.deepEqual(hero.outside, [], `every part of the hero drawing stays inside its figure at ${width}px`);
    assert.ok(hero.sideBySide !== hero.stacked && hero.captionsUnder, `the two moments stand side by side or stacked, with the captions under them, at ${width}px: ${JSON.stringify(hero)}`);
    if (width >= 1280) assert.ok(hero.sideBySide && hero.art.top + (hero.art.bottom - hero.art.top) / 2 < 900, `the moments stand side by side with at least half of the hero drawing above the fold at ${width}px: ${JSON.stringify(hero)}`);
    // The offer card may float over the checkout's corner, but nothing in the drawing lies over the drawn Pay now.
    const overPay = await page.locator('.story-art').evaluate(art => {
      const pay = art.querySelector('.sk-pay'), range = document.createRange();
      range.selectNodeContents(pay);
      const text = range.getBoundingClientRect();
      return [...art.querySelectorAll('.story *')].filter(el => !el.contains(pay) && !pay.contains(el)).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left < text.right && r.right > text.left && r.top < text.bottom && r.bottom > text.top;
      }).map(el => `${el.tagName.toLowerCase()}.${el.getAttribute('class') || ''}`);
    });
    assert.deepEqual(overPay, [], `nothing covers the checkout's Pay now at ${width}px`);
    if (width === 390) {
      assert.ok(hero.stacked, 'the two moments stack at 390px');
      assert.ok(await page.locator('.import-art').isVisible() && await page.locator('.licence-art').isVisible(), 'the licence card and import window stay at 390px');
      assert.equal(await page.locator('.parts').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
    }
    if (width === 1440) assert.equal(await page.locator('.parts').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 4);
    // The desk drawings in a row of four end on one line, so the numerals and titles under them share a baseline.
    if (await page.locator('.parts').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length) === 4) {
      const desk = await page.locator('.parts > li').evaluateAll(items => items.map(item => ({ frame: item.querySelector('.d-card').getBoundingClientRect().bottom, numeral: item.querySelector('.step').getBoundingClientRect(), title: item.querySelector('h3').getBoundingClientRect().top })));
      const spread = values => Math.max(...values) - Math.min(...values);
      assert.ok(spread(desk.map(item => item.frame)) <= 2, `the four desk frames end on one line at ${width}px: ${desk.map(item => item.frame.toFixed(1))}`);
      assert.ok(spread(desk.map(item => item.numeral.top)) <= 2 && spread(desk.map(item => item.numeral.bottom)) <= 2, `the four desk numerals share a baseline at ${width}px: ${desk.map(item => `${item.numeral.top.toFixed(1)}-${item.numeral.bottom.toFixed(1)}`)}`);
      assert.ok(spread(desk.map(item => item.title)) <= 2, `the four desk titles share a baseline at ${width}px`);
    }
  }
  checks.push('the four desk drawings end on one line, with their numerals and titles on one baseline, at every four-up width');

  checks.push('no horizontal overflow, drawing text of 12px or more, contained drawings, the hero\'s two moments side by side on wide screens (at least half the drawing above the fold from 1280px) and stacked on phones with the captions under them, the checkout\'s Pay now clear of the offer card and every other part of the drawing, the logo\'s three sparks springing from the top-right corners of four cards at the mark\'s own offset and a constant size, inside their figures and clear of every heading and caption, the flourish clear of all text and controls, and the lockup\'s mark on the headline\'s left edge at desktop widths, at 17 widths from 320px to 1920px');

  // Motion: the hero flourish draws in once as the page appears; reduced motion removes every animation and transition and smooth scrolling.
  await page.setViewportSize({ width: 1440, height: 900 });
  const motion = () => page.locator('.h2h-home').evaluate(root => ({
    animated: [...root.querySelectorAll('.d-sparks path, .hero-flourish path')].filter(path => getComputedStyle(path).animationName !== 'none').length,
    transitions: [...root.querySelectorAll('.pill')].filter(el => parseFloat(getComputedStyle(el).transitionDuration) > 0).length,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
  }));
  const full = await motion();
  assert.ok(full.animated > 0 && full.transitions > 0 && full.scrollBehavior === 'smooth', JSON.stringify(full));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  assert.deepEqual(await motion(), { animated: 0, transitions: 0, scrollBehavior: 'auto' });
  const frozen = await page.locator('.d-sparks path').evaluateAll(paths => paths.map(path => [getComputedStyle(path).strokeDashoffset, getComputedStyle(path).strokeDasharray]));
  assert.deepEqual(frozen, Array(12).fill(['0px', 'none']), 'sparks fully drawn under reduced motion');
  assert.deepEqual(await page.locator('.hero-flourish path').evaluate(path => [getComputedStyle(path).animationName, getComputedStyle(path).strokeDashoffset, getComputedStyle(path).strokeDasharray]), ['none', '0px', '1px, 2px'], 'the flourish stands fully drawn under reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // A fresh load: the flourish draws in once, eased, after a short delay, from hidden to fully drawn, and nothing moves while it does.
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const drawing = await page.evaluate(() => {
    const path = document.querySelector('.hero-flourish path');
    const [animation] = document.getAnimations().filter(a => a.effect?.target === path);
    const timing = animation.effect.getComputedTiming();
    const keyframes = animation.effect.getKeyframes().map(frame => frame.strokeDashoffset);
    const box = () => { const svg = document.querySelector('.hero-flourish').getBoundingClientRect(); const copy = document.querySelector('.hero-copy').getBoundingClientRect(); return [svg.width, svg.height, svg.top, copy.height]; };
    return { name: animation.animationName, duration: timing.duration, delay: timing.delay, iterations: timing.iterations, easing: getComputedStyle(path).animationTimingFunction, keyframes, box: box() };
  });
  assert.equal(drawing.name, 'h2h-flourish');
  assert.ok(drawing.duration >= 1000 && drawing.duration <= 1800 && drawing.delay > 0 && drawing.delay <= 600 && drawing.iterations === 1 && drawing.easing.startsWith('cubic-bezier'), `the flourish draws in once in 1-1.8s, eased, after a short delay: ${JSON.stringify(drawing)}`);
  assert.deepEqual(drawing.keyframes, ['1.02px', '0px'], 'from hidden to fully drawn');
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState === 'finished'), null, { timeout: 5000 });
  const drawn = await page.evaluate(() => { const svg = document.querySelector('.hero-flourish').getBoundingClientRect(); return { offset: getComputedStyle(document.querySelector('.hero-flourish path')).strokeDashoffset, box: [svg.width, svg.height, svg.top, document.querySelector('.hero-copy').getBoundingClientRect().height] }; });
  assert.equal(drawn.offset, '0px', 'the flourish ends fully drawn');
  assert.deepEqual(drawn.box, drawing.box, 'drawing the flourish moves nothing (no layout shift)');
  checks.push('the hero flourish animates once by default (the flourish over 1.5s, eased, after 0.35s, ending fully drawn with no layout shift); reduced motion disables animation, transitions and smooth scrolling and shows the flourish fully drawn');

  // The moments below the hero. Each waits in its first frame until it crosses the reveal line (85% down the viewport), then
  // plays once: a few short, eased animations that end within 1.8s and come to rest on exactly the drawing reduced motion
  // shows. Nothing is laid out again (every element keeps its layout box) and the page's layout shift stays at about zero.
  const momentNames = ['figure licence-art', 'ul proof', 'div divider', 'li Chat widget', 'li Shared inbox', 'li Help centre', 'li Suggested replies', 'div divider', 'ol steps', 'figure import-art', 'h2 get-started-title'];
  const watchMoments = () => {
    window.__shifts = [];
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shifts.push(entry.value); }).observe({ type: 'layout-shift', buffered: true });
    window.__starts = 0;
    document.addEventListener('animationstart', event => { if (event.target.closest?.('[data-reveal]')) window.__starts += 1; }, true);
    window.__name = el => `${el.tagName.toLowerCase()} ${el.id || el.querySelector(':scope > h3')?.textContent || el.classList[el.classList.length - 1]}`;
    window.__played = [];
    new MutationObserver(records => { for (const record of records) {
      const el = record.target;
      if (record.attributeName !== 'data-reveal' || el.dataset.reveal !== 'play') continue;
      const animations = el.getAnimations({ subtree: true });
      window.__played.push({ name: window.__name(el), line: el.getBoundingClientRect().top / innerHeight, count: animations.length,
        end: Math.max(...animations.map(a => a.effect.getComputedTiming().endTime)), once: animations.every(a => a.effect.getComputedTiming().iterations === 1),
        eased: animations.filter(a => !['h2h-type', 'h2h-caret'].includes(a.animationName)).every(a => a.effect.getKeyframes()[0].easing !== 'linear'),
        names: [...new Set(animations.map(a => a.animationName))].sort() });
    } }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-reveal'] });
  };
  // Every property a moment animates, and every element's layout box, for each element of each moment. The layout box is the
  // element's place on the page before any transform: its offsets summed up the chain of offset parents, and its size.
  const snapshot = () => { const layoutBox = el => { let x = 0, y = 0; for (let node = el; node; node = node.offsetParent) { x += node.offsetLeft + (node === el ? 0 : node.clientLeft); y += node.offsetTop + (node === el ? 0 : node.clientTop); } return [x, y, el.offsetWidth, el.offsetHeight].join(); }; return [...document.querySelectorAll('main [data-reveal], main .divider, .free .proof, .parts > li, #move-in .steps, #get-started h2, figure.drawing:not(.story-art)')].filter((el, i, all) => all.indexOf(el) === i).map(moment => [moment, ...moment.querySelectorAll('*')].map(el => {
    const style = getComputedStyle(el), before = el instanceof HTMLElement ? getComputedStyle(el, '::before') : null;
    return [style.opacity, style.translate, style.scale, style.transform, style.clipPath, style.backgroundSize, style.backgroundColor, style.strokeDashoffset, style.strokeDasharray, before?.opacity, before?.scale,
      el instanceof HTMLElement ? layoutBox(el) : ''].join('|');
  })); };
  const motionContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await motionContext.addInitScript(watchMoments);
  const motionPage = await motionContext.newPage();
  await motionPage.goto(origin, { waitUntil: 'networkidle' });
  await motionPage.evaluate(() => document.fonts.ready);
  await motionPage.waitForTimeout(2000);
  assert.deepEqual(await motionPage.evaluate(() => [...document.querySelectorAll('[data-reveal]')].map(el => `${window.__name(el)}: ${el.dataset.reveal}`)), momentNames.map(name => `${name}: wait`), 'below the fold, the eleven moments wait in their first frames');
  const held = await motionPage.evaluate(snapshot);
  const fromTop = await motionPage.evaluate(() => [...document.querySelectorAll('[data-reveal]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(el => window.__name(el)));
  await motionPage.evaluate(() => { window.__shifts = []; }); // from here on, only what scrolling and the reveals do
  await scrollThrough(motionPage);
  const played = await motionPage.evaluate(() => window.__played);
  assert.deepEqual(played.map(moment => moment.name), fromTop, 'each moment plays as it scrolls into view, from the top of the page down');
  for (const moment of played) {
    const where = JSON.stringify(moment);
    assert.ok(moment.line > 0 && moment.line <= 0.86, `a moment plays once it crosses the reveal line, 85% down the viewport: ${where}`);
    assert.ok(moment.count > 0 && moment.once && moment.eased && moment.end <= 1800, `a moment is a few short, eased animations that play once and end within 1.8s: ${where}`);
  }
  assert.deepEqual(Object.fromEntries(played.map(moment => [moment.name, moment.names])), {
    'figure licence-art': ['h2h-bloom', 'h2h-pen', 'h2h-pop', 'h2h-rise', 'h2h-sweep'],
    'ul proof': ['h2h-pop', 'h2h-rise'],
    'div divider': ['h2h-pen'],
    'li Chat widget': ['h2h-bloom', 'h2h-pen', 'h2h-pop', 'h2h-rise'],
    'li Shared inbox': ['h2h-bloom', 'h2h-pop', 'h2h-rise', 'h2h-slide'],
    'li Help centre': ['h2h-bloom', 'h2h-caret', 'h2h-pen', 'h2h-pop', 'h2h-rise', 'h2h-type'],
    'li Suggested replies': ['h2h-bloom', 'h2h-pop', 'h2h-rise'],
    'ol steps': ['h2h-pop'],
    'figure import-art': ['h2h-bloom', 'h2h-pen', 'h2h-pop', 'h2h-rise', 'h2h-tick'],
    'h2 get-started-title': ['h2h-pen'],
  }, 'each moment is the one its section asks for: the licence card lands and is highlighted, the promises pop in, the dividers and the closing line are drawn, the desk cards rise with their own small moment, the steps pop and the import ticks through to complete');
  const rested = await motionPage.evaluate(snapshot);
  // Offsets are whole pixels, rounded along the chain of offset parents, so a box may read 1px apart; anything more is a move.
  const moved = rested.flatMap((moment, m) => moment.map((el, i) => [el.split('|').at(-1), held[m][i].split('|').at(-1)]).filter(([now, then]) => now.split(',').some((value, k) => Math.abs(Number(value) - Number(then.split(',')[k])) > 1)));
  assert.equal(rested.flat().length, held.flat().length);
  assert.deepEqual(moved, [], 'no element of any moment changes its layout box from waiting to rest');
  const shifts = await motionPage.evaluate(() => window.__shifts.reduce((sum, value) => sum + value, 0));
  assert.ok(shifts < 0.001, `the reveals cause no layout shift while the page is scrolled through: ${shifts}`);
  // Once played, a moment never plays again: scrolled back up and down, nothing restarts.
  const starts = await motionPage.evaluate(() => window.__starts);
  await motionPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await motionPage.waitForTimeout(300);
  await scrollThrough(motionPage);
  assert.deepEqual(await motionPage.evaluate(() => ({ starts: window.__starts, played: window.__played.length, states: [...new Set([...document.querySelectorAll('[data-reveal]')].map(el => el.dataset.reveal))], running: document.getAnimations().filter(a => a.playState === 'running').length })), { starts, played: 11, states: ['play'], running: 0 }, 'scrolled through again, no moment plays a second time');
  // Nor when the layout changes under it: a window resized across the phone breakpoint and back (as a rotated phone does)
  // swaps the dividers' lines but draws nothing in again.
  for (const size of [{ width: 600, height: 900 }, { width: 1440, height: 900 }, { width: 900, height: 600 }, { width: 1440, height: 900 }]) {
    await motionPage.setViewportSize(size);
    await motionPage.waitForTimeout(300);
    assert.deepEqual(await motionPage.evaluate(() => ({ starts: window.__starts, running: document.getAnimations().filter(a => a.playState === 'running').length })), { starts, running: 0 }, `resized to ${size.width}x${size.height}, no moment plays again`);
  }
  // Under reduced motion nothing waits or moves, and the page is the same final drawing the moments came to rest on.
  const stillContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await stillContext.addInitScript(watchMoments);
  const stillPage = await stillContext.newPage();
  await stillPage.goto(origin, { waitUntil: 'networkidle' });
  await stillPage.evaluate(() => document.fonts.ready);
  assert.deepEqual(await stillPage.evaluate(snapshot), rested, 'the reduced-motion page is the final drawing from the first paint, identical to where the moments come to rest');
  await stillPage.evaluate(() => { window.__shifts = []; });
  await scrollThrough(stillPage);
  assert.deepEqual(await stillPage.evaluate(() => ({ marked: document.querySelectorAll('[data-reveal]').length, starts: window.__starts, animations: document.getAnimations().length, shifts: window.__shifts.reduce((sum, value) => sum + value, 0) })), { marked: 0, starts: 0, animations: 0, shifts: 0 }, 'under reduced motion no moment waits, nothing animates and nothing shifts');
  await stillContext.close();
  await motionContext.close();
  // A moment already above the reveal line when the page wakes up stays drawn, so nothing seen is hidden again: on a 1600px tall
  // screen the licence drawing is in view from the first paint, while the promises below the line still wait for the scroll.
  const tallContext = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  const tall = await tallContext.newPage();
  await tall.goto(origin, { waitUntil: 'networkidle' });
  await tall.waitForTimeout(300);
  assert.deepEqual(await tall.evaluate(() => ['.licence-art', '#free .proof'].map(selector => { const el = document.querySelector(selector); return [selector, el.getBoundingClientRect().top < innerHeight * 0.85, el.getAttribute('data-reveal'), el.getAnimations({ subtree: true }).length, getComputedStyle(el.querySelector('.d-card, .proof-icon')).opacity]; })), [['.licence-art', true, null, 0, '1'], ['#free .proof', false, 'wait', 0, '0']], 'a moment in view at load is simply drawn; one below the line waits');
  await tallContext.close();
  // The help-centre search types its query: the clip opens in 22 even steps, one a letter, never in one jump from hidden to
  // shown, and the caret rides the edge of the typing the whole way, then fades once the query is complete.
  const typingContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const typing = await typingContext.newPage();
  await typing.goto(origin, { waitUntil: 'networkidle' });
  await typing.evaluate(() => document.fonts.ready);
  await typing.evaluate(() => document.querySelector('.help-query').closest('li').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await typing.waitForFunction(() => document.querySelector('.help-query').closest('li').dataset.reveal === 'play');
  const typed = await typing.evaluate(() => {
    const query = document.querySelector('.help-query');
    const animations = document.getAnimations().filter(a => a.effect?.target === query);
    const type = animations.find(a => a.animationName === 'h2h-type' && !a.effect.pseudoElement), caret = animations.find(a => a.animationName === 'h2h-caret' && a.effect.pseudoElement === '::after');
    animations.forEach(a => a.pause());
    const { delay, duration } = type.effect.getComputedTiming();
    const frames = [];
    for (let letter = 0; letter < 22; letter++) {
      const time = delay + (letter + 0.5) * duration / 22;
      type.currentTime = time; caret.currentTime = time;
      const after = getComputedStyle(query, '::after');
      frames.push([Number(getComputedStyle(query).clipPath.match(/^inset\(0px ([\d.]+)%? 0px -2px\)$/)?.[1]), parseFloat(after.translate), after.opacity]);
    }
    animations.forEach(a => a.finish());
    return { duration, steps: type.effect.getKeyframes()[0].easing, frames, rest: [getComputedStyle(query).clipPath, getComputedStyle(query, '::after').opacity] };
  });
  await typingContext.close();
  const insets = typed.frames.map(([inset]) => inset);
  assert.ok(typed.duration === 700 && typed.steps === 'steps(22)' && insets.every((inset, letter) => Math.abs(inset - (22 - letter) / 22 * 100) < 0.01), `the query is typed in 22 even steps over 0.7s, from hidden to its last letter: ${JSON.stringify(typed)}`);
  assert.ok(typed.frames.every(([inset, caret, opacity]) => Math.abs(caret + inset) < 0.01 && opacity === '1'), `the caret is drawn at the edge of the typing on every step: ${JSON.stringify(typed.frames)}`);
  assert.deepEqual(typed.rest, ['inset(0px 0px 0px -2px)', '0'], 'once typed, the whole query shows and the caret is gone');
  checks.push('the help-centre search types its query in 22 even steps over 0.7s with the caret riding the edge, then rests on the whole query without a caret');
  checks.push('below the hero, eleven moments wait in their first frames, play once each as they cross 85% of the viewport (from the top of the page down, eased, done within 1.8s), come to rest on exactly the reduced-motion drawing without any element changing its layout box or any layout shift, never replay (scrolled through again or resized across the phone breakpoint), never wait under reduced motion, and stay drawn when already in view at load');

  // Accessibility: axe-core WCAG A and AA at the wide and narrow layouts, once every moment has played, so all of it is checked.
  await scrollThrough(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.deepEqual(await axeViolations(), [], `axe-core violations at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  checks.push('axe-core reports no WCAG 2.x A or AA violation at 1440px and 390px');

  // Keyboard focus is a visible ink outline, never the browser's blue ring.
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur?.(); });
  const rings = [];
  for (let step = 0; step < 6; step++) {
    await page.keyboard.press('Tab');
    rings.push(await page.evaluate(() => { const style = getComputedStyle(document.activeElement); return [document.activeElement.textContent.trim(), style.outlineStyle, style.outlineColor, parseFloat(style.outlineWidth)]; }));
  }
  assert.ok(rings.every(([, style, color, width]) => style === 'solid' && color === 'rgb(20, 20, 20)' && width >= 2), JSON.stringify(rings));
  checks.push('keyboard focus shows a solid ink outline on the skip link, wordmark, navigation and calls to action');
  await page.goto(origin, { waitUntil: 'networkidle' });

  // Keyboard and anchors.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to the product');
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash, '#product');
  await page.getByRole('link', { name: 'HappyToHelp' }).last().click();
  assert.equal(new URL(page.url()).hash, '#top');
  checks.push('skip link and wordmark anchors work from the keyboard and pointer');

  // No layout shift while Outfit loads: a layout-shift observer runs from before the first paint while the Outfit files are held
  // back, so the page is first laid out in the metric-matched fallback; then Outfit is let through. The headline wraps the same
  // in both faces, the hero copy and drawing keep their places, and the page's cumulative layout shift stays at about zero.
  for (const [width, height] of [[1440, 900], [1536, 1024]]) {
    const swapContext = await browser.newContext({ viewport: { width, height } });
    await swapContext.addInitScript(() => {
      window.__layoutShifts = [];
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__layoutShifts.push(entry.value); }).observe({ type: 'layout-shift', buffered: true });
    });
    const swapPage = await swapContext.newPage();
    let releaseFonts;
    const fontsHeld = new Promise(resolve => { releaseFonts = resolve; });
    await swapPage.route(/\/fonts\/outfit\/[^/]+\.woff2$/, async route => { await fontsHeld; await route.continue(); });
    await swapPage.goto(origin, { waitUntil: 'domcontentloaded' });
    await swapPage.locator('#hero-title').waitFor();
    await swapPage.waitForTimeout(1000);
    const layout = () => swapPage.evaluate(() => ({
      outfit: document.fonts.check('600 80px Outfit'),
      faces: [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family.replace(/["']/g, '')),
      headline: (() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('#hero-title')); return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; })(),
      tops: ['.site-header .brand', '.site-header nav', '#hero-title', '.hero-sub', '.hero-copy .actions', '.hero-free', '.hero-flourish', '.story-art', '.hero-moments', '#free'].map(selector => document.querySelector(selector).getBoundingClientRect().top),
    }));
    const fallback = await layout();
    assert.ok(!fallback.outfit && fallback.faces.length > 0 && fallback.faces.every(family => family === 'Outfit Fallback'), `the page first lays out in the metric-matched fallback at ${width}px: ${JSON.stringify(fallback)}`);
    releaseFonts();
    await swapPage.evaluate(() => document.fonts.ready);
    await swapPage.waitForFunction(() => document.fonts.check('600 80px Outfit'));
    await swapPage.waitForTimeout(600);
    const swapped = await layout();
    assert.deepEqual(swapped.headline, fallback.headline, `the headline wraps the same in the fallback and in Outfit at ${width}px`);
    assert.ok(swapped.tops.every((top, i) => Math.abs(top - fallback.tops[i]) <= 1), `the header, hero copy, drawing and next section keep their places when Outfit swaps in at ${width}px: ${fallback.tops} -> ${swapped.tops}`);
    const shift = await swapPage.evaluate(() => window.__layoutShifts.reduce((sum, value) => sum + value, 0));
    assert.ok(shift < 0.001, `cumulative layout shift while Outfit loads is about zero at ${width}px: ${shift}`);
    await swapContext.close();
  }
  checks.push('with Outfit held back, the page first lays out in the metric-matched Outfit Fallback; when Outfit swaps in the headline wraps the same, the header, hero and next section move by 1px or less, and cumulative layout shift stays under 0.001 at 1440x900 and 1536x1024');

  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${evidence}/homepage-${width}-fold.png` });
    await page.screenshot({ path: `${evidence}/homepage-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/results.json`, JSON.stringify({ origin, checks, errors }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser.close(); }
