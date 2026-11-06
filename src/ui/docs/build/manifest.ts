import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// docs/site.json is the one list of what the site publishes from the repository's Markdown, in display order, and of
// what stays on GitHub. This module reads it and enforces its rules; tests/journeys/public.mjs checks the coverage rule.

export const manifestPath = 'docs/site.json';

export type ManifestPage = { section: string; slug: string; label: string; source: string; href: string; hidden: boolean };
export type ManifestSection = { title: string; pages: ManifestPage[] };
export type GithubOnlyEntry = { source: string; reason: string };
export type Manifest = { sections: ManifestSection[]; pages: ManifestPage[]; githubOnly: GithubOnlyEntry[] };

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const docsHref = (slug: string) => slug ? `/docs/${slug}` : '/docs';

const isFile = (root: string, source: string) => existsSync(join(root, source)) && statSync(join(root, source)).isFile();
const text = (value: unknown) => typeof value === 'string' ? value : '';

/** Reads and validates docs/site.json. Every rule violation is listed in one thrown error. */
export function readManifest(root: string): Manifest {
  const raw = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
  const problems: string[] = [];
  const sources = new Set<string>();
  const slugs = new Set<string>();
  const useSource = (source: string, where: string) => {
    if (!source.endsWith('.md')) problems.push(`${where}: source "${source}" is not a Markdown file`);
    else if (!isFile(root, source)) problems.push(`${where}: source "${source}" does not exist`);
    if (sources.has(source)) problems.push(`${where}: source "${source}" is listed more than once`);
    sources.add(source);
  };
  const sections: ManifestSection[] = (Array.isArray(raw.sections) ? raw.sections : []).map((section: Record<string, unknown>, s: number) => {
    const title = text(section.title).trim();
    if (!title) problems.push(`section ${s + 1} has no title`);
    const entries = Array.isArray(section.pages) ? section.pages : [];
    if (!entries.length) problems.push(`section "${title}" has no pages`);
    const pages = entries.map((page: Record<string, unknown>, p: number): ManifestPage => {
      const slug = text(page.slug), label = text(page.label).trim(), source = text(page.source);
      const where = `page ${p + 1} of "${title}"`;
      if (slug === '') {
        if (s !== 0 || p !== 0) problems.push(`${where}: the docs home (slug "") must be the first page of the first section`);
      } else if (!slugPattern.test(slug) || slug === 'index') problems.push(`${where}: slug "${slug}" must be lowercase words joined by hyphens, and not "index"`);
      if (slugs.has(slug)) problems.push(`${where}: slug "${slug}" is used twice`);
      slugs.add(slug);
      if (!label) problems.push(`${where}: no label`);
      useSource(source, where);
      return { section: title, slug, label, source, href: docsHref(slug), hidden: page.hidden === true };
    });
    return { title, pages };
  });
  if (!sections.length) problems.push('no sections');
  if (!slugs.has('')) problems.push('no docs home: the first page needs slug ""');
  const githubOnly: GithubOnlyEntry[] = (Array.isArray(raw.githubOnly) ? raw.githubOnly : []).map((entry: Record<string, unknown>, index: number) => {
    const source = text(entry.source), reason = text(entry.reason).trim();
    useSource(source, `githubOnly entry ${index + 1}`);
    if (!reason) problems.push(`githubOnly entry "${source}" has no reason`);
    return { source, reason };
  });
  if (problems.length) throw new Error(`${manifestPath} is invalid:\n- ${problems.join('\n- ')}`);
  return { sections, pages: sections.flatMap(section => section.pages), githubOnly };
}
