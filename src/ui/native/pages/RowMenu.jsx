import React, {Children, useSyncExternalStore} from 'react';
import './stack-table.css';
import { tooltip } from '../../../modules/tooltip/tooltip';

// Matches the stack-table breakpoint: below it list rows are cards and row actions are shown, not folded into a menu.
const stackedQuery = '(max-width: 767px)';
const subscribe = listener => {
    const query = window.matchMedia(stackedQuery);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
};
const useStackedRows = () => useSyncExternalStore(subscribe, () => window.matchMedia(stackedQuery).matches, () => false);

/**
 * Row actions for list tables. On wide screens they sit behind a ⋮ disclosure; on phones every action is a visible
 * control on the row card, so nothing a row can do is hidden. `className` styles the wide-screen menu.
 */
export default function RowMenu({label, className, children}) {
    const actions = Children.toArray(children);
    if (useStackedRows()) return <div className="row-actions-inline" role="group" aria-label={`Actions for ${label}`}>{actions.flatMap((action, index) => index ? [' ', action] : [action])}</div>;
    return <details className={className}><summary {...tooltip('More actions')}><span aria-hidden="true">⋮</span></summary><div>{actions}</div></details>;
}
