import React, { useState, useEffect } from "react";
import Modal from "react-bootstrap/Modal";
import { Button, Form } from "react-bootstrap";
import "./index.css";

function EditProjectModal({ show, onHide, onConfirm, project }) {
  const [editingProject, setEditingProject] = useState({
    name: "",
    status: "",
    address: "",
    clientName: "",
  });

  useEffect(() => {
    if (project) {
      setEditingProject({
        name: project.name ?? "",
        status: project.status ?? "",
        address: project.address ?? "",
        clientName: project.clientName ?? "",
      });
    }
  }, [project]);

  const resetFields = () => {
    setEditingProject({
      name: "",
      status: "",
      address: "",
      clientName: "",
    });
  };

  const handleSave = () => {
    onConfirm(editingProject);
    resetFields();
    onHide();
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton onClick={resetFields}>
        <Modal.Title className="fw-bold" style={{ fontSize: "18px" }}>
          Edit Project
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group
            className="mb-3 d-flex flex-column"
            controlId="ControlInput1"
            style={{ width: "350px" }}
          >
            <div className="d-flex">
              <Form.Label className="add-team-modal-text mb-0 d-flex align-items-center justify-content-start">
                Project Name
              </Form.Label>
              <Form.Control
                type="text"
                value={editingProject?.name}
                placeholder="enter project name"
                autoFocus
                onChange={(e) =>
                  setEditingProject({
                    ...editingProject,
                    name: e.target.value,
                  })
                }
              />
            </div>
          </Form.Group>
          <Form.Group
            className="mb-3 d-flex flex-column"
            controlId="exampleForm.ControlInput1"
            style={{ width: "350px" }}
          >
            <div className="d-flex">
              <Form.Label className="add-team-modal-text mb-0 d-flex align-items-center justify-content-start">Address</Form.Label>
              <Form.Control
                type="text"
                value={editingProject?.address}
                placeholder="enter address"
                onChange={(e) =>
                  setEditingProject({
                    ...editingProject,
                    address: e.target.value,
                  })
                }
              />
            </div>
          </Form.Group>
          <Form.Group
            className="mb-3 d-flex flex-column"
            controlId="exampleForm.ControlInput1"
            style={{ width: "350px" }}
          >
            <div className="d-flex">
              <Form.Label className="add-team-modal-text mb-0 d-flex align-items-center justify-content-start">
                Client Name
              </Form.Label>
              <Form.Control
                type="text"
                value={editingProject?.clientName}
                placeholder="enter client name"
                onChange={(e) =>
                  setEditingProject({
                    ...editingProject,
                    clientName: e.target.value,
                  })
                }
              />
            </div>
          </Form.Group>
          <Form.Group className="d-flex flex-column">
            <div className="d-flex">
              <Form.Label
                style={{ width: "105px" }}
                className="add-team-modal-text"
              >
                Project Status
              </Form.Label>
              <div>
                <Form.Check
                  type="checkbox"
                  label="Open"
                  value="open"
                  checked={editingProject?.status === "open"}
                  onChange={() =>
                    setEditingProject({ ...editingProject, status: "open" })
                  }
                />
                <Form.Check
                  type="checkbox"
                  label="Quotation Requested"
                  value="quotation_requested"
                  checked={editingProject?.status === "quotation_requested"}
                  onChange={() =>
                    setEditingProject({
                      ...editingProject,
                      status: "quotation_requested",
                    })
                  }
                />
                <Form.Check
                  type="checkbox"
                  label="Pending Approval"
                  value="quotation_pending_approval"
                  checked={
                    editingProject?.status === "quotation_pending_approval"
                  }
                  onChange={() =>
                    setEditingProject({
                      ...editingProject,
                      status: "quotation_pending_approval",
                    })
                  }
                />
                <Form.Check
                  type="checkbox"
                  label="Quotation Sent"
                  value="quotation_sent"
                  checked={editingProject?.status === "quotation_sent"}
                  onChange={() =>
                    setEditingProject({
                      ...editingProject,
                      status: "quotation_sent",
                    })
                  }
                />
                <Form.Check
                  type="checkbox"
                  label="Quotation Accepted"
                  value="quotation_accepted"
                  checked={
                    editingProject?.status === "quotation_accepted"
                  }
                  onChange={() =>
                    setEditingProject({
                      ...editingProject,
                      status: "quotation_accepted",
                    })
                  }
                />
                <Form.Check
                  type="checkbox"
                  label="Closed"
                  value="closed"
                  checked={editingProject?.status === "closed"}
                  onChange={() =>
                    setEditingProject({
                      ...editingProject,
                      status: "closed",
                    })
                  }
                />
              </div>
            </div>
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer  className="bg-light">
        <Button
          variant="primary"
          disabled={
            !editingProject?.name ||
            !editingProject?.status ||
            !editingProject?.address ||
            !editingProject?.clientName
          }
          onClick={handleSave}
          style={{ minWidth: "130px" }}
        >
          Save
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default EditProjectModal;
