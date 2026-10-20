// The shapes the docs virtual modules export (src/ui/docs/build/plugin.ts) and the docs components read.

/** The public repository the pages link to for anything unpublished, and for "Edit this page". */
export type DocsRepository = { url: string; branch: string };

/** One h2 or h3 of a page, for its contents list. */
export type DocsTocEntry = { depth: 2 | 3; id: string; text: string };

/** One published page in the section navigation, in manifest order. */
export type DocsNavPage = { slug: string; label: string; href: string; source: string };

export type DocsSection = { title: string; pages: DocsNavPage[] };

/** A page rendered from Markdown at build time: its title, contents and body HTML. */
export type DocsPageData = {
  slug: string;
  source: string;
  title: string;
  titleId: string;
  description: string;
  html: string;
  toc: DocsTocEntry[];
};

/** What a docs route loads: the page, the navigation and repository it is shown with, and the docs version it came from. */
export type DocsView = { page: DocsPageData; sections: DocsSection[]; repository: DocsRepository; version: number; search?: boolean };
