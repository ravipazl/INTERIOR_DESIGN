// Default `React` import required — JSX here compiles to React.createElement()
// under this project's classic runtime. See Slider/index.js.
import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import './index.css';

const ImageLandscape = ({ url, title = '', uploadedImageRef }) => (
    <Fragment>
        <img ref={uploadedImageRef} className="landscape-comparing-image" src={url} alt={title} />
    </Fragment>
);

Image.propTypes = {
    url: PropTypes.string.isRequired,
    title: PropTypes.string
}

Image.defaultProps = {
    title: ''
}

export default ImageLandscape;