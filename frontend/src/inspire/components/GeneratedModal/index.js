import React from "react";
import Modal from "react-bootstrap/Modal";
import { Button } from "react-bootstrap";

function GeneratedModal({ show, onHide, body }) {
  return (
    <Modal show={show} onHide={onHide} size="md" centered>
      <Modal.Header className="bg-danger d-flex justify-content-center">
        <Modal.Title className="fs-16 text-white">Error</Modal.Title>
      </Modal.Header>
      <div
        className="my-3 d-flex justify-content-center"
        style={{ margin: "0px !important", padding: "20px" }}
      >
        {body}
      </div>
      <Modal.Footer className="bg-light" >
        <Button className="outline-button" variant="outlined" onClick={onHide}>
          Okay
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default GeneratedModal;
