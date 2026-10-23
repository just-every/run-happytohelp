import React, {useCallback, useContext, useEffect, useId, useState} from "react";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faTimes as falTimes} from "@fortawesome/free-solid-svg-icons";
import AppContext from "./context/AppContext";
import ModalPreview from './ModalPreview';
import Media from './Media';

import {useDropzone} from "react-dropzone";
import { tooltip } from '../../tooltip/tooltip';

function markupFiles(files) {
    // Path is read only. Only name is provided in some cases, so map this to path for ease of use
    files.map(file => {
        if(!file.path && file.name) {
            Object.defineProperty(file, "path", {
                value: file.name,
                writable: false
            });
        }
        return file;
    });
    // Add a preview data URI
    files.map(file => Object.assign(file, {
        isImage: /\.(jpe?g|png|gif)$/i.test(file.path),
        preview: file.preview || URL.createObjectURL(file)
    }));
}
function cleanupFiles(files) {
    // Revoke data URIs to avoid memory leaks
    files.forEach(file => file.preview && URL.revokeObjectURL(file.preview))
    files.map(file => Object.assign(file, {
        preview: false
    }));
}

async function resize(file, maxSize){
    let canvas;
    if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(maxSize, maxSize);
    } else {
        canvas = document.createElement('canvas');
    }
    const ctx = canvas.getContext('2d');

    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // Skip resizing if the image is already smaller than the maxSize
    if (width <= maxSize && height <= maxSize) {
        return file;
    }

    const ratio = Math.min(maxSize / width, maxSize / height);
    const newWidth = Math.round(width * ratio);
    const newHeight = Math.round(height * ratio);

    canvas.width = newWidth;
    canvas.height = newHeight;

    ctx.drawImage(bitmap, 0, 0, width, height, 0, 0, newWidth, newHeight);

    return new Promise(resolve => {
        canvas.convertToBlob ? canvas.convertToBlob({ type: file.type }).then(resolve) : canvas.toBlob(blob => resolve(blob), file.type, 0.8);
    });
}

export const FileHandlerContext = React.createContext({ isDragActive: false, dragOpen: () => {} })

export function FileHandler(props) {
    const context = useContext(AppContext);
    const isPreview = context.preview?.enabled === true;

    const files = props.files;
    const setFiles = props.setFiles;
    const onDrop = useCallback(async acceptedFiles => {
        if(isPreview || !context.settings.message.collect_attachments) return;
        // Resize images to a max of 2000 pixels in any dimension
        const resizedFiles = await Promise.all(acceptedFiles.map(async file => {
            if (file.type.startsWith('image/')) {
                const resizedBlob = await resize(file, 2000);
                if (resizedBlob instanceof Blob) {
                    return new File([resizedBlob], file.name, { type: file.type });
                }
                return file;
            }
            return file;
        }));
        // Merge and dedupe using paths & sizes
        var keys = new Set(files.map(d => d.path+d.size))
        setFiles([...files, ...resizedFiles.filter(d => !keys.has(d.path+d.size))])
    }, [files, isPreview, setFiles, context.settings.message.collect_attachments])

    const {getRootProps, getInputProps, open, isDragActive} = useDropzone({
        accept: {
            'image/*': ['.jpeg', '.jpg', '.png', '.gif'],
            'video/*': ['.mp4', '.mpeg', '.ogv', '.webm', '.avi'],
            'audio/*': ['.mp3'],
            'text/*': ['.csv', '.txt'],
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        },
        noClick: true,
        disabled: isPreview,
        onDrop
    })

    return (<div className={props.className} {...getRootProps()}>
        <FileHandlerContext.Provider value={{ isDragActive, dragOpen: open }}>
            <input tabIndex="-1" {...getInputProps({ 'aria-label': context.text.message.tooltip_attach })} />
            {props.children}
        </FileHandlerContext.Provider>
    </div>)
}

export function FileHandlerList(props) {
    const context = useContext(AppContext);
    const { isDragActive } = React.useContext(FileHandlerContext)
    const [previewFile, setPreviewFile] = useState(false)
    const previewContainerRef = React.useRef(null);
    const hidePreview = useCallback(() => setPreviewFile(false), []);

    markupFiles(props.files)
    useEffect(() => {
        markupFiles(props.files)
        return () => {
            // This stops previews while sending
            //cleanupFiles(props.files)
        };
    }, [props.files]);

    const removeFile = file => () => {
        const newFiles = [...props.files]
        newFiles.splice(newFiles.indexOf(file), 1)
        cleanupFiles([file]);
        props.setFiles(newFiles)
    }

    const fileList = props.files.map(file => <AttachedFile key={ file.path+file.size } file={ file } onRemove={ removeFile(file) } setPreview={ setPreviewFile } />)

    return (<>
        <ModalPreview
            previewFile={previewFile}
            hide={hidePreview}
            containerRef={previewContainerRef}
        />
        {fileList.length ? (
            <div className="happytohelp-send-message-row" ref={previewContainerRef}>
                <ul className="happytohelp-files">{fileList}</ul>
            </div>
        ): null}
        {isDragActive && context.settings.message.collect_attachments ? (
            <div className="happytohelp-send-message-row happytohelp-send-message-row-drag-files">
                {context.text.message.placeholder_files}
            </div>
        ): null}
    </>)
}

// One attached file: its preview and its remove button, both described by the file's name.
function AttachedFile({ file, onRemove, setPreview }) {
    const nameId = useId();
    return (
        <li>
            <Media upload={ true } media={ file } setPreview={ setPreview } nameId={ nameId } />
            <button type="button" className="happytohelp-preview-close" { ...tooltip('Remove attachment', { describedBy: nameId }) } onClick={ onRemove }>
                <FontAwesomeIcon icon={falTimes} aria-hidden="true" />
            </button>
        </li>
    )
}

export function FileHandlerButton(props) {
    const { dragOpen } = React.useContext(FileHandlerContext)
    return (<div onClick={() => dragOpen()}>
        {props.children}
    </div>)
}
