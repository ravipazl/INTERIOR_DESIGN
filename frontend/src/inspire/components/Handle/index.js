import './index.css';
import React, { Component } from 'react';


const Handle = ({
    isDragStarted = false,
    positionLeft,
    onDragStop,
    onDragStart,
    elementRefference,
}) => {
    const onMouseDown = (e) => {
        e.preventDefault();
        onDragStart(e);
    };

    const onTouchStart = (e) => {
        e.preventDefault();
        onDragStart(e);
    };
    return (
        <span
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            onTouchEnd={onDragStop}
            onMouseUp={onDragStop}
            onTouchMove={(e) => {
                e.preventDefault();
                onDragStart(e);
            }}
            style={{ left: positionLeft }}
            ref={elementRefference}
            className={`cd-handle ${isDragStarted && 'draggable'}`}
        >
        </span>
    );
};

export default Handle;