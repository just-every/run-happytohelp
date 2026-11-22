import { PATHS } from './base/run-site'

export function withReleaseLaunch(html: string): string {
  return html
    .replaceAll(PATHS.self.note, 'A first local start usually takes about a minute. On a busy computer it can take longer: <code>rer dev</code> prints progress every 20 seconds, with the limit to allow.')
}

export function withReleaseHosting(html: string): string {
  return withReleaseLaunch(html)
    .replaceAll('run the same line from the same folder', 'run <code>rer dev</code> from the checkout')
    .replace('<h3 id="deploy">Deploy</h3>', '<h3 id="deploy">Deploy</h3><p>If the checkout has no saved owner name, add <code>--owner-name &quot;Your name&quot;</code> to the first deploy.</p>')
    .replace(/<li><strong>Update HappyToHelp:<\/strong>.*?<\/li>/,
      '<li><strong>Update HappyToHelp:</strong> follow <a href="/docs/updates-and-recovery">Updates and recovery</a> to select a release and preserve your data.</li>')
}
