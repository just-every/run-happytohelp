import { SearchField } from '../../site/docs-search/SearchField';
import { HydrationUnit } from '../../vendor/base/hydration/unit';
import { DocsNavList } from './DocsNavList';
import type { DocsSection } from './types';

/** The section navigation beside the page, from 861px. */
export function DocsSidebar({ sections, current, search }: { sections: DocsSection[]; current: string; search?: boolean }) {
  return <HydrationUnit><nav className="docs-sidebar" aria-label="Documentation">
    {search && <SearchField id="docs-sidebar-search" />}
    <DocsNavList sections={sections} current={current} idPrefix="docs-sidebar" />
  </nav></HydrationUnit>;
}
