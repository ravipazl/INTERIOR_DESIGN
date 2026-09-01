import { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import ImageSlider from './ImageSlider';
import Handler from './Handler';
import './index.css';
import FavOutline from "../../assets/images/favorite_add.svg";
import FavFill from "../../assets/images/favorite_fill.svg";

function Slider({ original, modified, delay = 0, generatedDesign, handleFavAddClick }) {
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
    const uploadedImageRef = useRef();

    useEffect(() => {
        setTimeout(() => setIsVisible(true), delay)
    }, []);

    useEffect(() => {
        // Calculate the maximum container width based on the container's offsetWidth
        const maxContainerWidth = container.current.offsetWidth * 0.8; // Set a maximum width (80% of container width, adjust as needed)

        setSizes({
            ...sizes,
            maxContainerWidth,
        });
    }, []);



    const onDragStart = (e) => {
        e.preventDefault();

        const dragWidth = dragElement.current.offsetWidth,
            xPosition = e.pageX || e.touches[0].pageX, // Handle touch event as well
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
            maxLeft: maxLeft - dragWidth, // Subtract the width of the Handler from the container width when calculating the maxLeft value
        });

        setDragStarted(true);
    };


    const containerOnMouseMove = (e) => {
        if (!isDragStarted || (!e.pageX && (!e.touches || e.touches.length === 0))) {
            return;
        }

        const pageX = e.pageX || e.touches[0].pageX;
        const newWidth = ((pageX - sizes.containerOffset) * 100) / sizes.containerWidth;
        const clampedWidth = Math.min(100, Math.max(0, newWidth));
        const uploadedWidth = ((pageX - sizes.containerOffset) * 100) / uploadedImageRef.current.clientWidth;
        const updatedClampedWidth = Math.min(100, Math.max(0, uploadedWidth));
        if (updatedClampedWidth === 100) {
            setDragStarted(false);
            return;
        }
        setSizes({
            ...sizes,
            resizableImageWidth: clampedWidth + '%',
        });
    };


    const onDragStop = () => {
        setDragStarted(false);
    };

    return (
        <figure
            onMouseMove={containerOnMouseMove}
            onTouchMove={containerOnMouseMove}
            onTouchStart={onDragStart}
            onTouchEnd={onDragStop}
            onClick={onDragStop}
            className={`cd-image-container ${isVisible && 'is-visible'}`}
            ref={container}
        >
            <ImageSlider {...original} />
            <div style={{ width: sizes.resizableImageWidth }}
                className={`cd-resize-img ${isDragStarted && 'resizable'}`}>
                <ImageSlider uploadedImageRef={uploadedImageRef} {...modified} />
            </div>
            <Handler isDragStarted={isDragStarted}
                onDragStart={onDragStart}
                onDragStop={onDragStop}
                positionLeft={sizes.resizableImageWidth}
                elementRefference={dragElement}
            />
            <div className='slider-favourite-icon'>
                {generatedDesign && (
                    <img
                        role="button"
                        src={generatedDesign.isFavorite ? FavFill : FavOutline}
                        alt="fav"
                        onClick={() => handleFavAddClick(generatedDesign)}
                    />
                )}
            </div>
        </figure>
    );
}

Slider.propTypes = {
    original: PropTypes.shape({
        url: PropTypes.string.isRequired,
        title: PropTypes.string
    }),
    modified: PropTypes.shape({
        url: PropTypes.string.isRequired,
        title: PropTypes.string
    })
}

export default Slider;