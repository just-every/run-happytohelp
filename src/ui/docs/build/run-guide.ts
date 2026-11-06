import { PATHS, startLine } from '../../../site/base/run-site';
import { run } from '../../../site/run';

// Keep the readable Markdown's launch examples in step with the same RunData
// used by /run and /docs/hosting. Other Markdown, including the legacy install
// reference, is rendered unchanged.
export function runGuide(markdown: string): string {
  const sections: Record<string, string> = {
    start: `\`\`\`sh\n${startLine(run)}\n\`\`\``,
    requirements: PATHS.self.requirements,
    alternative: `\`\`\`sh\n${run.clone}\n\`\`\``,
  };
  for (const [name, value] of Object.entries(sections)) {
    const section = new RegExp(`<!-- rer:${name} -->[\\s\\S]*?<!-- /rer:${name} -->`);
    if (!section.test(markdown)) throw new Error(`Getting-started guide needs its ${name} section.`);
    markdown = markdown.replace(section, () => value);
  }
  return markdown;
}
