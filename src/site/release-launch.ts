import { escape, PATHS, pipelines, startLine } from './base/run-site'
import { releaseCheckout, releaseNodeStart, releaseStart, run } from './run'

const command = (line: string) => pipelines(line)
  .replaceAll('https://github.com/', 'https://github.com/<wbr>')
  .replaceAll('just-every/run-happytohelp', 'just-every/<wbr>run-happytohelp')

export function withReleaseLaunch(html: string): string {
  const sharedStart = startLine(run)
  return html
    .replaceAll(pipelines(sharedStart), () => command(releaseStart))
    .replaceAll(`data-copy="${escape(sharedStart)}"`, () => `data-copy="${escape(releaseStart)}"`)
    .replace(/<code>(?:<span class="code-word">[^<]*<\/span> ?)+<\/code>/g, block =>
      block.replace(/<[^>]+>/g, '') === escape(run.clone) ? `<code>${command(releaseNodeStart)}</code>` : block)
    .replace('<code>$HOME/.local/bin/rer dev just-every/run-happytohelp</code>', () =>
      `<code>${command(`${releaseCheckout} && "$HOME/.local/bin/rer" dev`)}</code>`)
    .replaceAll(PATHS.self.note, 'A first local start usually takes about a minute. On a busy computer it can take longer: <code>rer dev</code> prints progress every 20 seconds, with the limit to allow.')
}

export function withReleaseHosting(html: string): string {
  return withReleaseLaunch(html)
    .replaceAll('run the same line from the same folder', 'run <code>rer dev</code> from the checkout')
    .replace('<h3 id="deploy">Deploy</h3>', '<h3 id="deploy">Deploy</h3><p>If the checkout has no saved owner name, add <code>--owner-name &quot;Your name&quot;</code> to the first deploy.</p>')
    .replace(/<li><strong>Update HappyToHelp:<\/strong>.*?<\/li>/,
      '<li><strong>Update HappyToHelp:</strong> follow <a href="/docs/updates-and-recovery">Updates and recovery</a> to select a release and preserve your data.</li>')
}
