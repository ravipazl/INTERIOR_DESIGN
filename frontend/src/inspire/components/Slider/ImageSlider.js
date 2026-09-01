import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import './index.css';

const ImageSlider = ({ url, title = '', uploadedImageRef }) => {
    return (
        <Fragment>
            <img ref={uploadedImageRef} className="comparing-image" src={url} alt={title} />
        </Fragment>
    )
};

Image.propTypes = {
    url: PropTypes.string.isRequired,
    title: PropTypes.string
}

Image.defaultProps = {
    title: ''
}

export default ImageSlider;