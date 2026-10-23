import React, { useId, useState } from 'react';
import PropTypes from 'prop-types';
import { Modal } from "react-bootstrap";

import prettyBytes from 'pretty-bytes';
import DialogHeader from './DialogHeader';
import { tooltip } from '../../../modules/tooltip/tooltip';

function Media({ media }) {
    const [showModal, setShowModal] = useState(false);
    const imageId = useId();

    const handleCloseModal = () => setShowModal(false);
    const handleShowModal = (e) => {
        e.preventDefault();
        setShowModal(true);

        return false;
    }

    return media.aggregate_type === 'image'
        ? <>
            <a href={ media.url } { ...tooltip('Open image') } aria-describedby={ imageId } onClick={ handleShowModal }><img id={ imageId } src={ media.preview_url ?? media.url } alt={ media.filename_original } /></a>
            <Modal show={showModal} onHide={handleCloseModal} dialogClassName="modal-fullscreen">
                <DialogHeader closeButton>
                    <h4 className="mb-0">{ media.filename_original }</h4>
                </DialogHeader>
                <Modal.Body><img src={ media.url } alt={ media.filename_original } className="img-fluid" /></Modal.Body>
            </Modal>
        </>
        : <div className="media mb-1">
            <span className="icon-shape me-3" aria-hidden="true">
                <i className="fe fe-paperclip"></i>
            </span>
            <div className="media-body overflow-hidden flex-fill">
                <a href={ media.url } className="d-block text-truncate font-medium text-reset" target="_blank" rel="noreferrer">{ media.filename_original }</a>
                <ul className="list-inline small mb-0">
                    <li className="list-inline-item">
                        <span className="t">{ prettyBytes(media.size) }</span>
                    </li>
                </ul>
            </div>
        </div>;
}

Media.propTypes = {
    media: PropTypes.object,
};

export default Media;
