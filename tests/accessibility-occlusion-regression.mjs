import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createAxeAudit} from './helpers/accessibility-axe-audit.mjs';
import {runSteps} from './journeys/kit/steps.mjs';
export async function occlusionJourney(browser){
const evidenceDir = resolve(process.env.H2H_EVIDENCE_DIR || '/tmp/h2h-occlusion-regression');
await mkdir(evidenceDir, {recursive: true});

const results = [];
const page = await browser.newPage({viewport: {width: 600, height: 300}, deviceScaleFactor: 1});
try {
    await runSteps([
        ['partial-good', '#666', 100, false], ['partial-bad', '#aaa', 100, true],
        ['uncovered-bad', '#aaa', 0, true], ['fully-covered', '#aaa', 400, false],
    ].map(([label, color, covered, fails])=>[label,async()=>{
        await page.setContent(`<style>body{margin:40px}textarea{width:350px;height:60px;padding:12px;border:0;background:white;font:16px Arial}textarea::placeholder{color:${color};opacity:1}.cover{position:absolute;left:40px;top:40px;width:${covered}px;height:100px;background:#333;box-shadow:0 0 6px #0008}</style><textarea placeholder="A partially overlapped placeholder tests visible contrast"></textarea>${covered ? '<div class="cover">Overlapping text</div>' : ''}`);
        // Synthetic axe incomplete belongs to this oracle fixture. The actual
        // screenshots, glyphs, overlays and browser hit tests are never mocked.
        await page.evaluate(() => { window.axe = {run: async () => ({violations: [], passes: [], inapplicable: [], incomplete: [{id: 'color-contrast', nodes: [{target: ['textarea'], any: [{message: 'Review overlap', data: {expectedContrastRatio: 4.5}}]}]}]})}; });
        const incompleteContrast = [];
        const audit = createAxeAudit({axePath: '', evidenceDir, scans: [], axeIncomplete: [], incompleteContrast});
        if (fails) await assert.rejects(audit.scan(page, label), /below their WCAG text threshold|without an actual composite measurement/);
        else await audit.scan(page, label);
        const entry = incompleteContrast[0].entries[0];
        if (covered === 100) {
            assert.ok(entry.occlusion.coveredPixels > 0);
            assert.equal(entry.occlusion.status, 'LIMITED');
            assert.ok(entry.sampledPixels > 0);
            assert.equal(entry.status, fails ? 'failed' : 'measured');
            assert.ok(fails ? entry.minimumContrastRatio < 4.5 : entry.minimumContrastRatio >= 4.5);
        }
        if (covered === 400) assert.equal(entry.status, 'limited');
        results.push({label, status: entry.status, sampledPixels: entry.sampledPixels, ratio: entry.minimumContrastRatio, occlusion: entry.occlusion});
    }]));
    await writeFile(join(evidenceDir, 'regressions.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({passed: results.length, results}, null, 2));
} finally {await page.close();}
}
