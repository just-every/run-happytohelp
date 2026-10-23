import React, { useLayoutEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Dropdown from 'react-bootstrap/Dropdown';
import { tooltip } from '../../../../modules/tooltip/tooltip';

const sheetQuery = '(max-width: 767.98px)';
// Two columns are 30rem wide and open leftwards from the card's right edge.
const twoColumnRoom = 480;

function chooseLayout(toggle, hasAside) {
    if (window.matchMedia(sheetQuery).matches) return 'sheet';
    if (!hasAside) return 'popover';
    const column = toggle?.closest('.chat-body') || document.body;
    const card = toggle?.closest('.chat-footer, .conversation-notes-only') || toggle;
    const room = (card?.getBoundingClientRect().right ?? 0) - column.getBoundingClientRect().left;
    return room >= twoColumnRoom ? 'two-column' : 'popover';
}

// While the phone sheet is open the conversation keeps the reply card in view above it.
function useSheetRoom(active, menuRef, toggleRef) {
    useLayoutEffect(() => {
        const column = toggleRef.current?.closest('.chat-body');
        const menu = menuRef.current;
        if (!active || !column || !menu) return undefined;
        const apply = () => column.style.setProperty('--start-sheet-room', `${ Math.ceil(menu.getBoundingClientRect().height) }px`);
        apply();
        column.classList.add('has-start-sheet');
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
        observer?.observe(menu);
        return () => {
            observer?.disconnect();
            column.classList.remove('has-start-sheet');
            column.style.removeProperty('--start-sheet-room');
        };
    }, [ active, menuRef, toggleRef ]);
}

/**
 * The "+" start menu named "Actions": a popover rising from the "+" from 768 px (two columns when there is room) and a
 * bottom sheet with a grab handle and a pinned footer below 768 px. Two columns read `lead` then `trail` on the left
 * and `aside` on the right; one column reads `lead`, `aside`, `trail` (Reply, Write with AI, Ticket, Draft).
 */
export default function StartMenu({ id, disabled = false, lead, aside, trail, footer }) {
    const [ show, setShow ] = useState(false);
    const [ layout, setLayout ] = useState('popover');
    const toggleRef = useRef(null);
    const menuRef = useRef(null);
    const dragFrom = useRef(null);
    const onToggle = next => {
        if (next) setLayout(chooseLayout(toggleRef.current, Boolean(aside)));
        setShow(next);
    };
    useSheetRoom(show && layout === 'sheet', menuRef, toggleRef);
    const handle = {
        onPointerDown: event => { dragFrom.current = event.clientY; event.currentTarget.setPointerCapture?.(event.pointerId); },
        onPointerUp: event => { if (dragFrom.current !== null && event.clientY - dragFrom.current > 40) setShow(false); dragFrom.current = null; },
        onPointerCancel: () => { dragFrom.current = null; },
    };

    return <Dropdown show={ show } onToggle={ onToggle } drop="up" align={ { md: 'end' } } className="start-menu">
        <Dropdown.Toggle ref={ toggleRef } id={ id } variant="link" className="start-menu__toggle" disabled={ disabled } { ...tooltip('Actions') }>
            <i className="fe fe-plus" aria-hidden="true" />
        </Dropdown.Toggle>
        <Dropdown.Menu ref={ menuRef } role="menu" aria-label="Actions" className={ `start-menu__menu is-${ layout }` }>
            { layout === 'sheet' && <div className="start-menu__handle" aria-hidden="true" { ...handle }><span /></div> }
            <div className="start-menu__body">
                { layout === 'two-column'
                    ? <><div className="start-menu__column">{ lead }{ trail }</div><div className="start-menu__column">{ aside }</div></>
                    : <div className="start-menu__column">{ lead }{ aside }{ trail }</div> }
            </div>
            { footer && <div className="start-menu__footer" role="group" aria-label="Message actions">{ footer }</div> }
        </Dropdown.Menu>
    </Dropdown>;
}

StartMenu.propTypes = {
    id: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    lead: PropTypes.node.isRequired,
    aside: PropTypes.node,
    trail: PropTypes.node,
    footer: PropTypes.node,
};
