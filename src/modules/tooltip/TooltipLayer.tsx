import { useEffect, useRef } from 'react';
import { bindTooltips } from './tooltip';
import './tooltip.css';

/** Shows the tooltips of every control marked by tooltip() in the page while mounted. Render it once, near the root. */
export function TooltipLayer() {
    const tip = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const element = tip.current;
        if (element) return bindTooltips(element.ownerDocument, element);
    }, []);
    return <div ref={tip} className="ui-tooltip" role="tooltip" aria-hidden="true" popover="manual" />;
}
