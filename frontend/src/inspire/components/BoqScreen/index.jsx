import React from "react";
import { Modal, Button } from "react-bootstrap";
import BoqView from "../BoqView";

/**
 * BoqScreen — a modal wrapper around <BoqView>, used by the "View BOQ" button.
 * The same BOQ also renders inline as a Project Workspace section.
 */
function BoqScreen({ show, onHide, projectId, project, quoteNumber }) {
  return (
    <Modal show={show} onHide={onHide} size="xl" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: 18 }}>Bill of Quantity</Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ background: "#f3f4f6", padding: 12 }}>
        {show ? (
          <BoqView
            projectId={projectId}
            project={project}
            quoteNumber={quoteNumber}
          />
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default BoqScreen;
