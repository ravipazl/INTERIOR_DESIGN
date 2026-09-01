import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import Handle from "../Handle";
import './index.css'; // Import your CSS file
import ImageLandscape from '../ImageLandscape';

const SliderLandscape = ({ original, modified, delay = 0 }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isDragStarted, setDragStarted] = useState(false);
    const [sizes, setSizes] = useState({
        resizableImageWidth: '30%',
        resizableImageHeight: 'auto',
        dragWidth: 0,
        xPosition: 0,
        containerOffset: 0,
        containerWidth: 0,
        minLeft: 0,
        maxLeft: 0,
    });
    const dragElement = useRef(null);
    const container = useRef(null);
    const aspectRatio = useRef(null);
    const uploadedImageRef = useRef();

    useEffect(() => {
        setTimeout(() => setIsVisible(true), delay)
    }, []);

    useEffect(() => {
        // Calculate and store the aspect ratio when the original image is loaded
        if (original && original.width && original.height) {
            aspectRatio.current = original.width / original.height;
        }
    }, [original]);

    const onDragStart = (e) => {
        e.preventDefault();

        const dragWidth = dragElement.current.offsetWidth,
            xPosition = e.clientY || e.touches.item(0).clientY, // Handle touch event as well
            containerOffset = container.current.offsetLeft,
            containerWidth = container.current.offsetWidth,
            minLeft = containerOffset + 10,
            maxLeft = containerOffset + containerWidth - dragWidth - 10;

        setSizes({
            ...sizes,
            dragWidth,
            xPosition,
            containerOffset,
            containerWidth,
            minLeft,
            maxLeft
        });

        setDragStarted(true);
    };

    const onDragStop = () => {
        setDragStarted(false);
    };

    const containerOnMouseMove = (e) => {
        if (!isDragStarted || (!e.clientX && !e.clientY && (!e.touches || e.touches.length === 0))) {
            return;
        }
        if (window.matchMedia("(orientation: portrait)").matches) {
            const pageY = e.clientY || e.touches.item(0).clientY;
            const newWidth = (((pageY + (sizes.containerOffset - 44)) * 100) / sizes.containerWidth);
            const clampedWidth = Math.min(100, Math.max(0, newWidth));
            const uploadedWidth = ((pageY + (sizes.containerOffset - 44)) * 100) / uploadedImageRef.current.clientWidth;
            const updatedClampedWidth = Math.min(100, Math.max(0, uploadedWidth));
            if (updatedClampedWidth === 100) {
                setDragStarted(false);
                return;
            }
            setSizes({
                ...sizes,
                resizableImageWidth: clampedWidth + '%',
                resizableImageHeight: clampedWidth / aspectRatio.current + '%',
            });
        }
        if (window.matchMedia("(orientation: landscape)").matches) {
            const pageX = e.clientX || e.touches.item(0).clientX;
            const newWidth = ((pageX - (sizes.containerOffset + 10)) * 100) / sizes.containerWidth;
            const clampedWidth = Math.min(100, Math.max(0, newWidth));
            const uploadedWidth = ((pageX - (sizes.containerOffset + 10)) * 100) / uploadedImageRef.current.clientWidth;
            const updatedClampedWidth = Math.min(100, Math.max(0, uploadedWidth));
            if (updatedClampedWidth === 100) {
                setDragStarted(false);
                return;
            }
            setSizes({
                ...sizes,
                resizableImageWidth: clampedWidth + '%',
                resizableImageHeight: clampedWidth / aspectRatio.current + '%',
            });
        }
    };

    return (
        <figure
            onMouseMove={containerOnMouseMove}
            onTouchMove={containerOnMouseMove} // Add touch event handler
            onClick={onDragStop}
            onTouchEnd={onDragStop} // Add touch event handler
            className={`landscape-image-container ${isVisible && 'is-visible'}`}
            style={{ touchAction: 'none' }}
            ref={container}
        >
            <ImageLandscape {...original} />
            <div
                style={{
                    width: sizes.resizableImageWidth || '30%',
                    height: sizes.resizableImageHeight || 'auto',
                }}
                className={`landscape-resize-img ${isDragStarted && 'resizable'}`}
            >
                <ImageLandscape uploadedImageRef={uploadedImageRef} {...modified} />
            </div>
            <Handle
                isDragStarted={isDragStarted}
                onDragStart={onDragStart}
                onDragStop={onDragStop}
                positionLeft={sizes.resizableImageWidth}
                elementRefference={dragElement}
            />
        </figure>
    );
};

SliderLandscape.propTypes = {
    original: PropTypes.shape({
        url: PropTypes.string.isRequired,
        title: PropTypes.string,
        width: PropTypes.number,
        height: PropTypes.number,
    }),
    modified: PropTypes.shape({
        url: PropTypes.string.isRequired,
        title: PropTypes.string,
    }),
    delay: PropTypes.number,
}

export default SliderLandscape;
