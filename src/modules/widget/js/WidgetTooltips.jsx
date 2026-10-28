import React, { useEffect, useRef } from 'react';
import { installTooltips } from '../../tooltip/tooltip';

/** The tooltips of the widget's icon-only controls, inside its own shadow root and in its own type (src/modules/tooltip). */
export default function WidgetTooltips() {
    const anchor = useRef(null);
    useEffect(() => {
        const root = anchor.current?.getRootNode();
        const container = anchor.current?.parentElement;
        return root instanceof ShadowRoot && container ? installTooltips(root, container) : undefined;
    }, []);
    return <span ref={ anchor } hidden />;
}
