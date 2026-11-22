import { escape, pipelines, startLine } from './base/run-site'
import { releaseCheckout, releaseInstaller, releaseNodeStart, releasePackage, releaseStart, run } from './run'

// Base's shared renderer accepts an unversioned repository slug. Keep its layout
// and replace the launch commands together, including what the copy button writes.
export function withReleaseLaunch(html: string): string {
  const sharedStart = startLine(run)
  const copy = `data-copy="${escape(sharedStart)}"`
  if (!html.includes(copy) || !html.includes(pipelines(sharedStart))) {
    throw new Error('The shared Run page no longer exposes its launch command.')
  }
  const command = (line: string) => pipelines(line).replace('https://github.com/', 'https://github.com/<wbr>')
  return html
    .replace(pipelines(sharedStart), command(releaseStart))
    .replace(copy, `data-copy="${escape(releaseStart)}"`)
    .replace(/<code>(?:<span class="code-word">[^<]*<\/span> ?)+<\/code>/g, block =>
      block.replace(/<[^>]+>/g, '') === escape(run.clone) ? `<code>${command(releaseNodeStart)}</code>` : block)
    .replace('<code>curl -fsSL https://runeditrun.com/install.sh | sh</code>',
      `<code>${escape(`${releaseCheckout} && ${releaseInstaller}`)}</code>`)
    .replace('<code>$HOME/.local/bin/rer dev just-every/run-happytohelp</code>', '<code>$HOME/.local/bin/rer dev</code>')
    .replaceAll('run the same line from the same folder', 'run <code>rer dev</code> from the checkout')
    .replace('<span class="code-word">@runeditrun/rer</span>', `<span class="code-word">${escape(releasePackage)}</span>`)
}

export function withReleaseHosting(html: string): string {
  return withReleaseLaunch(html)
    .replace('<h3 id="deploy">Deploy</h3>', '<h3 id="deploy">Deploy</h3><p>If the checkout has no saved owner name, add <code>--owner-name &quot;Your name&quot;</code> to the first deploy.</p>')
    .replace(/<li><strong>Update HappyToHelp:<\/strong>.*?<\/li>/,
      '<li><strong>Update HappyToHelp:</strong> follow <a href="/docs/updates-and-recovery">Updates and recovery</a> to select a release and preserve your data.</li>')
}
