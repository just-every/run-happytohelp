import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../../transport';
import SecretSteps from '../../setup-help/SecretSteps';

const link = (href, text) => <a href={href} target="_blank" rel="noreferrer">{text}</a>;
const guide = '/docs/website-knowledge';
const apifyExample = 'your-apify-api-token';
const examples = { APIFY_TOKEN: apifyExample, APIFY_CRAWLER_ACTOR_ID: 'apify~website-content-crawler' };

/** What this installation's website reading needs, read once per page: which reader runs and the crawler's settings. */
export function useWebsiteReader(projectId, enabled = true) {
    const [reader, setReader] = useState(null);
    useEffect(() => {
        if (!enabled) return;
        nativeRequest('/api/knowledge/' + projectId + '/website-reader').then(setReader).catch(() => setReader(null));
    }, [projectId, enabled]);
    return reader;
}

/** The crawler service: what it is, what it costs, where each value comes from and exactly where it goes. */
function CrawlerSteps({ reader }) {
    const missing = reader.settings.filter(setting => !setting.set);
    return <>
        <p>The crawler service is <b>Apify</b>, a separate web-scraping service. Its Website Content Crawler opens each page in a real browser, so it also reads sites built with JavaScript, and it reads up to 10,000 pages. Apify’s free plan includes $5 of usage a month with no card; larger crawls are paid by usage ({link('https://apify.com/pricing', 'Apify pricing')}).</p>
        <ol>
            <li>Create an account at {link('https://console.apify.com/sign-up', 'console.apify.com')}.</li>
            <li>Open {link('https://console.apify.com/settings/integrations', 'Settings, API & Integrations')} and copy your <b>Personal API token</b>. It is <code>APIFY_TOKEN</code>.</li>
            <li><code>APIFY_CRAWLER_ACTOR_ID</code> names the crawler to run. Use Apify’s Website Content Crawler: <code>apify~website-content-crawler</code>.</li>
            <li>Add both to this installation{missing.length < reader.settings.length ? <> (<code>{missing.map(setting => setting.name).join(', ')}</code> is still missing)</> : ''}:</li>
        </ol>
        <SecretSteps installation={reader.installation} values={(missing.length ? missing : reader.settings).map(({ name }) => ({ name, example: examples[name] }))}/>
    </>;
}

/** Shown before a website source is saved and beside a saved one: how its pages are read and what that needs. */
export default function WebsiteReader({ reader }) {
    if (!reader) return null;
    const crawler = reader.reader === 'crawler';
    return <section className="knowledge-import-needs knowledge-website-reader" aria-label="How website reading works">
        <h3 className="knowledge-website-title">How website reading works</h3>
        {crawler && !reader.problem
            ? <p><span className="h2h-chip">Crawler service set up</span> This installation reads websites with the crawler service (Apify), up to Max Crawl Pages per refresh. Each refresh uses your Apify account’s usage.</p>
            : <p><span className="h2h-chip">Nothing to set up</span> HappyToHelp reads the pages itself: no account or key is needed. It starts at the Starting URL, follows links to pages under that address up to Max Crawl Depth, honours the site’s robots.txt and reads at most <b>{reader.builtInPageLimit} pages</b> per refresh. It reads public <code>https://</code> sites, and only the text in each page’s HTML.</p>}
        {reader.problem && <p role="alert" className="alert alert-danger">{reader.problem}</p>}
        <details open={Boolean(reader.problem)}>
            <summary>{crawler ? 'Crawler service settings' : 'Larger sites: the crawler service'}</summary>
            {!crawler && <p>Use the crawler for more than {reader.builtInPageLimit} pages, or for a site whose pages appear only after JavaScript runs (the built-in reader finds no text there). Once both values below are set, every website source uses it.</p>}
            <CrawlerSteps reader={reader}/>
        </details>
        <p className="settings-note">Full guide: <a href={guide}>Website knowledge</a>.</p>
    </section>;
}

/** A failed refresh in plain words, with the way to the steps that fix it. */
export function WebsiteReadFailure({ error }) {
    if (!error) return null;
    return <div role="alert" className="alert alert-danger">
        <p className="mb-1"><b>The last refresh did not finish.</b> {error}</p>
        <p className="mb-0">See “How website reading works” below, or the <a href={guide}>Website knowledge guide</a>.</p>
    </div>;
}
