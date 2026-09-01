import React, { useState, useEffect } from "react";
import "./index.css";
import Delete from "../../assets/images/delete.svg";
import Dropdown from "react-bootstrap/Dropdown";
import roomTypes from "../../utils/roomTypes.json";

const DropdownComponent = ({
  selectedItem,
  showDeleteItem,
  handleDropdownSelect,
  handleDeleteDropdown,
}) => {
  const isDefaultSelection = "Select Room";

  return (
    <>
      <div className="d-flex flex-row align-items-center my-1">
        <Dropdown onSelect={handleDropdownSelect}>
          <Dropdown.Toggle
            childBsPrefix={`dropdown_title ${isDefaultSelection ? "default_selection" : ""
              }`}
            id="dropdown-basic"
            className="d-flex align-items-center justify-content-between"
          >
            {selectedItem}
          </Dropdown.Toggle>

          {roomTypes && (
            <Dropdown.Menu>
              {roomTypes.map((item, index) => (
                <Dropdown.Item key={index} eventKey={item.roomType}>
                  {item.roomType}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          )}
        </Dropdown>
        {showDeleteItem && (
          <span className="mx-3">
            <img
              onClick={handleDeleteDropdown}
              role="button"
              src={Delete}
              alt="delete"
            />
          </span>
        )}
      </div>
    </>
  );
};

export default DropdownComponent;
