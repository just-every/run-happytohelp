import React, { useId, useState } from 'react';
import PropTypes from 'prop-types';
import { Modal } from "react-bootstrap";
import DialogHeader from './DialogHeader';
import { tooltip } from '../../../modules/tooltip/tooltip';

function FormMedia({ media, onRemove }) {
    const [showModal, setShowModal] = useState(false);
    const imageId = useId();

    const handleCloseModal = () => setShowModal(false);

    const handleRemove = event => {
        event.preventDefault();
        onRemove(media);

        return false;
    }

    const handleShowModal = (e) => {
        e.preventDefault();
        setShowModal(true);

        return false;
    }

    return media.aggregate_type === 'image'
        ? <>
            <div className="theme-file-preview position-relative me-3 dz-processing dz-image-preview dz-error dz-complete">
                <a className="avatar avatar-lg dropzone-image-preview bg-body-secondary rounded"
                   href="#"
                   { ...tooltip('Preview image') }
                   aria-describedby={ imageId }
                   onClick={ handleShowModal }>
                    <img
                        id={ imageId }
                        src={ media.preview_url ?? media.url }
                        alt={ media.filename_original }
                        className="avatar-img rounded file-title" />
                </a>
                <a className="badge badge-circle text-bg-secondary position-absolute badge-top-right" href="#" { ...tooltip('Remove attachment') } aria-describedby={ imageId } onClick={ handleRemove }>
                    <i className="fe fe-x" aria-hidden="true"></i>
                </a>
            </div>
            <Modal show={showModal} onHide={handleCloseModal}>
                <DialogHeader closeButton>
                    <h4 className="mb-0">{ media.filename_original }</h4>
                </DialogHeader>
                <Modal.Body><img src={ media.url } alt={ media.filename_original } className="img-fluid" /></Modal.Body>
            </Modal>
        </>
        : <div className="theme-file-preview position-relative me-3 dz-processing dz-image-preview dz-error dz-complete">
            <a href={ media.url } target="_blank" rel="noreferrer" className="avatar avatar-lg dropzone-image-preview" { ...tooltip('Open attachment') } aria-describedby={ imageId }>
                <span className="avatar-text rounded bg-secondary file-title" id={ imageId }><i className="fe fe-file" aria-hidden="true"></i><span className="visually-hidden">{ media.filename_original }</span></span>
            </a>
            <a className="badge badge-circle text-bg-secondary position-absolute badge-top-right" href="#" { ...tooltip('Remove attachment') } aria-describedby={ imageId } onClick={ handleRemove }>
                <i className="fe fe-x" aria-hidden="true"></i>
            </a>
        </div>;
}

FormMedia.propTypes = {
    media: PropTypes.object,
    onRemove: PropTypes.func,
};

export default FormMedia;
