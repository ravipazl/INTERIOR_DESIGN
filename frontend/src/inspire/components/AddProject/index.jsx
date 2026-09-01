import React, { useState } from "react";
import "./index.css";
import { Form, Button } from "react-bootstrap";
import CloseIcon from "@mui/icons-material/Close";

const AddProject = ({ currentProject, handleClose, handleSubmit }) => {
  const [project, setProject] = useState({
    name: currentProject?.name ?? "",
    clientName: currentProject?.clientName ?? "",
    address: currentProject?.address ?? "",
  });

  return (
    <>
      <div className="bg-container">
        <div className="d-flex justify-content-center align-items-center mb-3">
          <div className="detail-container">
            <div style={{ width: "4em" }} />
            <div>PROJECT DETAILS</div>
            <div className="detail-container2">
              <CloseIcon
                className="project-detail-close"
                onClick={handleClose}
              />
            </div>
          </div>
        </div>
        <div className="d-flex justify-content-center align-items-center">
          <Form className="form-detail">
            <Form.Group controlId="formName">
              <Form.Control
                className="address mb-4"
                type="text"
                placeholder="Project Name"
                value={project.name}
                onChange={(e) => {
                  if (e.target.value) {
                    setProject({
                      ...project,
                      name: e.target.value,
                    });
                  }
                }}
              />
            </Form.Group>
            <Form.Group controlId="formName">
              <Form.Control
                className="name mb-4"
                type="text"
                placeholder="Client Name"
                value={project.clientName}
                onChange={(e) => {
                  if (e.target.value) {
                    setProject({
                      ...project,
                      clientName: e.target.value,
                    });
                  }
                }}
              />
            </Form.Group>

            <Form.Group controlId="formEmail">
              <Form.Control
                className="email mb-4"
                type="text"
                placeholder="Address"
                value={project.address}
                onChange={(e) => {
                  if (e.target.value) {
                    setProject({
                      ...project,
                      address: e.target.value,
                    });
                  }
                }}
              />
            </Form.Group>

            <div className="d-grid gap-2">
              <Button
                variant="primary"
                className="primary-button-filled"
                onClick={() => handleSubmit(project)}
              >
                Save Project
              </Button>
            </div>
          </Form>
        </div>
      </div>
    </>
  );
};

export default AddProject;
