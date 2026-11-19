import React, { useEffect, useRef, useState } from "react";
import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import "../PzTable/Modal.css";
import "./index.css";

const MAX_NAME = 120;

// What a copy brings along, and what starts fresh — shown so nobody expects
// the quotes or renders to come with it.
const COPIED = [
  "Project details (client, address, owner)",
  "Floor plan — walls, rooms, doors and windows",
  "All furniture, with its parts and finishes",
  "Wall, floor and ceiling finishes",
];
const FRESH = [
  "Status (starts as Open)",
  "Architect",
  "Quotes and BOQ numbers",
  "Renders, documents and change requests",
];

/**
 * "Copy project" — asks for the new name, then makes the copy.
 * `onConfirm(name)` resolves to the new project, or throws with a message.
 */
function CopyProjectModal({ show, project, onHide, onConfirm }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (show) {
      setName(project?.name ? `${project.name} (copy)`.slice(0, MAX_NAME) : "");
      setError("");
      setBusy(false);
    }
  }, [show, project]);

  const trimmed = name.trim();
  const canCopy = !!trimmed && trimmed.length <= MAX_NAME && !busy;

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (!canCopy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(trimmed);
    } catch (err) {
      setError(err?.message || "The project could not be copied. Please try again.");
      setBusy(false);
    }
  };

  return (
    <Modal
      show={show}
      onHide={busy ? undefined : onHide}
      onEntered={() => inputRef.current && inputRef.current.select()}
      centered
      backdrop={busy ? "static" : true}
      keyboard={!busy}
      className="pz-modal pz-copy-project"
      backdropClassName="pz-modal-backdrop"
    >
      <Modal.Header closeButton={!busy}>
        <Modal.Title>Copy project</Modal.Title>
      </Modal.Header>
      <Form onSubmit={submit}>
        <Modal.Body>
          <p className="pzc-from">
            Makes a new project with the same design as{" "}
            <strong>{project?.name || "this project"}</strong>. The original is not
            changed.
          </p>
          <Form.Group controlId="pzc-name">
            <Form.Label>New project name</Form.Label>
            <Form.Control
              ref={inputRef}
              type="text"
              value={name}
              maxLength={MAX_NAME}
              disabled={busy}
              isInvalid={!!error}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
            />
            <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
          </Form.Group>
          <div className="pzc-lists">
            <div>
              <div className="pzc-head">Copied</div>
              <ul className="pzc-list pzc-list--yes">
                {COPIED.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="pzc-head">Starts fresh</div>
              <ul className="pzc-list pzc-list--fresh">
                {FRESH.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer className="bg-light">
          <Button
            variant="outline"
            className="outline-button me-2"
            style={{ minWidth: "130px" }}
            disabled={busy}
            onClick={onHide}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            style={{ minWidth: "130px" }}
            disabled={!canCopy}
          >
            {busy ? "Copying…" : "Create copy"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

export default CopyProjectModal;
