import React from "react";
import Modal from "react-bootstrap/Modal";
import { Button } from "react-bootstrap";

function ConfirmationModal({ show, onHide, body, onConfirm }) {
  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header className="d-flex justify-content-center bg-danger">
        <Modal.Title className="fs-16 text-white">Confirmation</Modal.Title>
      </Modal.Header>
      <div className="my-4 py-2 px-4 text-center">{body}</div>
      <Modal.Footer className="bg-light d-flex">
        <Button
          variant="outline"
          className="outline-button me-2"
          style={{ minWidth: "130px" }}
          onClick={onHide}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={onConfirm}
          className="primary-button-filled ms-2"
          style={{ minWidth: "130px" }}
        >
          Delete
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default ConfirmationModal;
