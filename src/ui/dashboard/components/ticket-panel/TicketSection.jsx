import React from 'react';
import PropTypes from 'prop-types';
import ReplyIcon from '../reply-icons/ReplyIcon';

/**
 * One collapsed section of the Ticket tab. Its body stays mounted while collapsed, so the section can show a count
 * (or a short meta such as a running total) and keep its drafts; `hidden` takes it out of view and the tab order.
 */
export default function TicketSection({ id, title, badge, open, onToggle, children }) {
    const headingId = `ticket-section-${ id }-heading`;
    const bodyId = `ticket-section-${ id }`;
    // A badge may be a component that renders nothing yet; an empty badge is not drawn.
    const shown = badge !== undefined && badge !== null && badge !== '' && badge !== 0;
    return <div className={ `ticket-section${ open ? ' is-open' : '' }` } data-section={ id }>
        <h3 className="ticket-section__heading">
            <button type="button" id={ headingId } className="ticket-section__toggle" aria-expanded={ open } aria-controls={ bodyId } onClick={ () => onToggle(id) }>
                <span className="ticket-section__title">{ title }</span>
                { shown && <span className="ticket-section__badge">{ badge }</span> }
                <ReplyIcon name="chevron-right" className="ticket-section__chevron" />
            </button>
        </h3>
        <div id={ bodyId } className="ticket-section__body" aria-labelledby={ headingId } role="group" hidden={ !open }>
            { children }
        </div>
    </div>;
}

TicketSection.propTypes = {
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    badge: PropTypes.node,
    open: PropTypes.bool,
    onToggle: PropTypes.func.isRequired,
    children: PropTypes.node,
};
