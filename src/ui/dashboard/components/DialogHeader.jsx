import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import Modal from 'react-bootstrap/Modal';
import CloseButton from 'react-bootstrap/CloseButton';
import ModalContext from 'react-bootstrap/ModalContext';
import { tooltip } from '../../../modules/tooltip/tooltip';

/** A dialog's header whose × has its tooltip: Modal.Header draws its own close button, which takes no other props. */
export default function DialogHeader({ closeButton = false, children, ...props }) {
    const modal = useContext(ModalContext);
    return <Modal.Header { ...props }>
        { children }
        { closeButton && <CloseButton { ...tooltip('Close') } onClick={ () => modal?.onHide() } /> }
    </Modal.Header>;
}

DialogHeader.propTypes = {
    closeButton: PropTypes.bool,
    children: PropTypes.node,
};
