import React, { useState } from 'react';
import { Modal } from "react-bootstrap";
import Api from "../api";
import DialogHeader from './DialogHeader';
import { tooltip } from '../../../modules/tooltip/tooltip';

function WidgetImagesModal({ onSelect, onHide }) {
    const [ isLoading, setIsLoading ] = useState(null);
    const [ images, setImages ] = useState(null);
    const [ keyword, setKeyword ] = useState('');

    const handleSubmit = e => {
        e.preventDefault();

        setIsLoading(true);
        Api.get(`/projects/${ window.chatSettings.project.id }/theme-images?q=${ keyword }`)
            .then(data => {
                setIsLoading(false);
                setImages(data.data);
                console.log(data);
            })
            .catch(error => {
                setIsLoading(false);
                console.log(error);
            });

        return false;
    }

    const handleSelect = (image) => {
        onSelect(image.src.medium, image.avg_color);
    }

    return (
        <Modal show onHide={ onHide }>
            <DialogHeader closeButton>
                <Modal.Title>Search Background Image</Modal.Title>
            </DialogHeader>
            <Modal.Body>
                <form onSubmit={ handleSubmit } method="GET">
                    <div className="input-group mb-3">
                        <input type="text" className="form-control" placeholder="Keyword" aria-label="Keyword" value={ keyword } onChange={ e => setKeyword(e.target.value) } disabled={ isLoading } required />
                        <button className="btn btn-primary" type="submit" style={{ borderTopLeftRadius:0, borderBottomLeftRadius: 0 }} disabled={ isLoading } { ...tooltip('Search images') }><i className="fe fe-search" aria-hidden="true"></i></button>
                    </div>
                </form>
                { Array.isArray(images) && images.length === 0 && <div className="alert alert-secondary mb-0" role="alert">No images found</div> }
                { Array.isArray(images) && <div className="text-center">
                    { images.map(image => <a href="#" { ...tooltip('Use this image') } onClick={ e => { e.preventDefault(); handleSelect(image); return false; } } key={ image.id } className="m-3 d-inline-block"><img src={ image.src.small } className="img-thumbnail rounded" alt="" /></a>) }
                    <p className="small mb-0">Photos provided by <a href="https://pexels.com" target="_blank">Pexels</a></p>
                </div> }
                { isLoading && <div className="text-center p-3">
                    <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">Loading...</span>
                    </div>
                </div> }
            </Modal.Body>
        </Modal>
    );
}

export default WidgetImagesModal;
