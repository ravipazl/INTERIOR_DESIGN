import React from "react";
import Modal from "react-bootstrap/Modal";
import { Button } from "react-bootstrap";

function GetQuoteModal({ show, onHide, body, onConfirm }) {
  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header className="d-flex justify-content-center bg-danger">
        <Modal.Title className="fs-16 text-white">Confirmation</Modal.Title>
      </Modal.Header>
      <div className="my-4 py-3 d-flex justify-content-center">{body}</div>
      <Modal.Footer className="bg-light">
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
          onClick={() => {
            onConfirm();
            onHide();
          }}
          className="primary-button-filled ms-2"
          style={{ minWidth: "130px" }}
        >
          Submit
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default GetQuoteModal;
