import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DocsRepository, DocsSection } from '../types.ts';
import type { LinkContext, PathKind } from './links.ts';
import { manifestPath, readManifest } from './manifest.ts';
import type { ManifestPage } from './manifest.ts';
import { renderPage } from './render.ts';
import type { RenderedPage } from './render.ts';
import { runGuide } from './run-guide.ts';

// The whole docs site from the tree as it is: every page listed in docs/site.json rendered, every link and anchor
// checked across pages, and nothing that names a build machine's paths. The Vite plugin and the tests share this.

export type SitePage = ManifestPage & RenderedPage;
export type Site = { repository: DocsRepository; sections: DocsSection[]; pages: SitePage[]; problems: string[]; files: string[] };

/** The same absolute-path pattern the reproducible-build case of tests/journeys/installer-nightly.mjs refuses in emitted code. */
export const absolutePath = /(?<![\w.@~-])\/(?:Users|home|private|tmp|var\/folders|root)\/[^\s"'`\\]*/g;

/** The repository's GitHub URL and the branch its links name. */
export function readRepository(root: string): DocsRepository {
  const { repository } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof repository?.url !== 'string' || !repository.url) throw new Error('package.json has no repository.url for the docs links');
  return { url: repository.url, branch: 'main' };
}

export const pathKind = (root: string) => (path: string): PathKind => {
  const full = join(root, path);
  if (!existsSync(full)) return null;
  return statSync(full).isDirectory() ? 'directory' : 'file';
};

export function buildSite(root: string): Site {
  const repository = readRepository(root);
  const manifest = readManifest(root);
  const published = new Map(manifest.pages.map(page => [page.source, page.href]));
  const kind = pathKind(root);
  const context = (source: string): LinkContext => ({ source, repository, published, kind });
  const files = [join(root, manifestPath), join(root, 'package.json')];
  const read = (source: string) => {
    files.push(join(root, source));
    const markdown = readFileSync(join(root, source), 'utf8');
    return source === 'docs/getting-started.md' ? runGuide(markdown) : markdown;
  };
  const pages: SitePage[] = manifest.pages.map(page => ({ ...page, ...renderPage(read(page.source), context(page.source)) }));
  const problems: string[] = [];
  const ids = new Map(pages.map(page => [page.source, new Set(page.ids)]));
  // Anchors into unpublished Markdown are checked against that file's GitHub heading ids.
  const idsOf = (source: string) => {
    if (!ids.has(source)) ids.set(source, new Set(renderPage(read(source), context(source)).ids));
    return ids.get(source)!;
  };
  for (const page of pages) {
    const report = (problem: string) => problems.push(`${page.source}: ${problem}`);
    page.problems.forEach(report);
    for (const anchor of page.anchors) {
      if (!idsOf(anchor.source).has(anchor.id)) report(`#${anchor.id} (no such heading in ${anchor.source})`);
    }
    for (const leak of new Set(page.html.match(absolutePath) ?? [])) report(`${leak} (an absolute machine path would leak into the build)`);
  }
  const sections = manifest.sections.map(section => ({
    title: section.title,
    pages: section.pages.filter(page => !page.hidden).map(({ slug, label, href, source }) => ({ slug, label, href, source })),
  }));
  return { repository, sections, pages, problems, files: [...new Set(files)] };
}
