import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

// The quiet line of an inbox row (H16, ConversationItemMeta) keeps its parts by priority: the ticket's states, then the
// first tag, then a due time or snooze, then the workspace's name. They share one line when they fit. When they do not,
// the workspace keeps its colour dot (its name stays its tooltip and screen-reader text) and the parts that do not fit
// move, whole and in that order, to a second line. A part given less room than its text ends in an ellipsis, with its
// full text in its tooltip, and keeps at least four letters' width.
const PRIORITY = [ 'states', 'tags', 'due' ];
const MIN_EM = 4;

/**
 * Where each part goes, from widths in px: `parts` in priority order, each { key, word, width, min, end } (`end` is what
 * follows the part's own text, the tag's "+n"); `sep` is what a middle dot adds between two words (its width and a
 * gap). Returns the workspace name (false: its dot alone; true: in full; a number: its width), the lines as
 * [{ key, sep }] (sep: a middle dot leads the part) and the narrowed parts' widths.
 */
export function planQuietLine({ width, gap, sep, workspace, parts }) {
    const span = items => items.reduce((sum, item, index) => sum + item.width + (index ? gap : 0)
        + (index && item.word && items[index - 1].word ? sep : 0), 0);
    const widths = {};
    // One line's parts, its lowest-priority parts narrowed (each to its minimum at most) until the line fits.
    const line = items => {
        let over = span(items) - width;
        for (const item of [ ...items ].reverse()) {
            const cut = Math.min(over, item.width - item.min);
            if (item.key && cut > 0) {
                widths[item.key] = Math.floor(item.width - cut - item.end);
                over -= cut;
            }
        }
        return items.flatMap((item, index) => item.key ? [ { key: item.key, sep: Boolean(index && item.word && items[index - 1].word) } ] : []);
    };
    if (workspace) {
        const named = { width: workspace.dot + workspace.gap, word: true };
        const room = width - span([ named, ...parts ]);
        if (room >= Math.min(workspace.name, workspace.min)) {
            return { name: room >= workspace.name ? true : Math.floor(room), lines: [ line([ named, ...parts ]) ], widths };
        }
    }
    const dot = workspace ? [ { width: workspace.dot, word: false } ] : [];
    if (parts.length < 2 || span([ ...dot, ...parts ]) <= width) return { name: false, lines: [ line([ ...dot, ...parts ]) ], widths };
    let split = parts.length - 1;
    while (split > 1 && span([ ...dot, ...parts.slice(0, split) ]) > width) split--;
    return { name: false, lines: [ line([ ...dot, ...parts.slice(0, split) ]), line(parts.slice(split)) ], widths };
}

// A part's own width at its full text, whether it shows in full, narrowed or only to screen readers (scrollWidth keeps
// the text's width; one px covers its rounding).
const natural = element => element.scrollWidth + element.offsetWidth - element.clientWidth + 1;
const gapOf = element => parseFloat(getComputedStyle(element).columnGap) || 0;

function measure(meta) {
    const style = getComputedStyle(meta);
    const min = MIN_EM * parseFloat(style.fontSize);
    const workspace = meta.querySelector('.conversation-item-workspace');
    const parts = [ ...meta.querySelectorAll('[data-quiet]') ].map(element => {
        const key = element.dataset.quiet;
        if (key !== 'tags') {
            const width = natural(element);
            return { key, word: true, width, min: Math.min(width, min), end: 0 };
        }
        const chip = natural(element.querySelector('.conversation-tag'));
        const more = element.querySelector('.conversation-item-more-tags');
        const end = more ? gapOf(element) + more.getBoundingClientRect().width : 0;
        return { key, word: false, width: chip + end, min: Math.min(chip, min) + end, end };
    }).sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key));
    const gap = gapOf(meta.firstElementChild);
    return {
        width: meta.getBoundingClientRect().width,
        gap,
        sep: parseFloat(style.getPropertyValue('--quiet-sep')) + gap,
        workspace: workspace && {
            dot: workspace.querySelector('.conversation-item-workspace-dot').getBoundingClientRect().width,
            gap: gapOf(workspace),
            name: natural(workspace.querySelector('[data-quiet-name]')),
            min,
        },
        parts,
    };
}

// One observer for every row: a width change (the window, Select tickets) re-fits each line before the browser paints.
const fits = new WeakMap();
let observer = null;

function watch(element, fit) {
    if (typeof ResizeObserver === 'undefined') return () => {};
    observer ??= new ResizeObserver(entries => flushSync(() => entries.forEach(entry => fits.get(entry.target)?.())));
    fits.set(element, fit);
    observer.observe(element);
    return () => {
        observer.unobserve(element);
        fits.delete(element);
    };
}

/** The quiet line's ref and its plan (null until first measured: everything on one line, the name in full). */
export default function useQuietLine() {
    const elementRef = useRef(null);
    const [ plan, setPlan ] = useState(null);

    const fit = useCallback(() => {
        const element = elementRef.current;
        if (!element?.isConnected) return;
        const input = measure(element);
        // A list out of view (behind an open conversation on a phone) has no width to fit; keep the plan for its return.
        if (!input.width) return;
        const next = planQuietLine(input);
        setPlan(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }, []);

    // After every render: the row's parts or their words may have changed.
    useLayoutEffect(fit);

    const ref = useCallback(element => {
        elementRef.current = element;
        if (!element) return undefined;
        const unwatch = watch(element, fit);
        return () => {
            unwatch();
            elementRef.current = null;
        };
    }, [ fit ]);

    return [ ref, plan ];
}
