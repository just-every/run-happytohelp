import React, {useState} from 'react';
import PropTypes from 'prop-types';
import { tooltip } from '../../tooltip/tooltip';

function humanFileSize (size) {
    if(size < 1) return "0 bytes";
    // http://stackoverflow.com/a/20732091
    var factor = 1000; // Technically it should be 1024, but looks like most apps use 1000...
    var i = Math.floor( Math.log(size) / Math.log(factor) );
    return ( size / Math.pow(factor, i) ).toFixed(1) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

function Media({ upload, media, setPreview }) {
    const [loaded, setLoaded] = useState(upload);

    // Try to normalise this data @todo correct params at source
    if(upload) {
        media.filename = (media.name || media.path || '').replace(/^(?:\.\/)+/, '');
        media.url = media.url ?? media.preview;
    }
    else {
        media.isImage = media.aggregate_type === 'image';
        media.filename = (media.filename_original || '').replace(/^(?:\.\/)+/, '');
        media.preview = media.preview_url ?? media.url;
    }

    return media.isImage ? <button type="button" className="happytohelp-preview-trigger" { ...tooltip('Preview image') } onClick={() => setPreview(media)}>
            <img
                src={media.preview}
                className={ "happytohelp-preview " + (loaded ? "happytohelp-preview-loaded" : "happytohelp-preview-loading")}
                alt=""
                style={{ maxWidth: '100%' }}
                onLoad={() => setLoaded(true)} />
        </button>
            :
        <div className="happytohelp-preview">
            <a href={media.preview} target="_blank" rel="noopener noreferrer">{media.filename}</a>
            {media.size ? " ("+humanFileSize(media.size)+")" : ""}
        </div>;
}

Media.propTypes = {
    media: PropTypes.object,
};

export default Media;
