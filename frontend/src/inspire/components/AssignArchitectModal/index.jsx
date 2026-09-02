import React, { useState, useEffect, useContext } from "react";
import Modal from "react-bootstrap/Modal";
import { Button, Form, Dropdown } from "react-bootstrap";
import ServiceContext from "../../context/ServiceContext";
import "./index.css";
import { getAllArchitects } from "../../services/authService";
import { Divider, Typography, Checkbox } from "@mui/material";

function AssignArchitectModal({ show, onHide, onConfirm, project }) {
  const [selectedArchitect, setSelectedArchitect] = useState("");
  const [architects, setArchitects] = useState([]);
  const {authService} = useContext(ServiceContext);

  useEffect(() => {
    if (project?.architectUser) {
      setSelectedArchitect(project?.architectUser);
    }
  }, [project]);

  useEffect(() => {
    getArchitects();
  }, []);

  const getArchitects = async () => {
    const resp = await authService.getAllArchitects();
    if (resp?.data?.length) {
      setArchitects(resp.data);
    }
  };

  const resetFields = () => {
    setSelectedArchitect("");
  };

  const handleSave = () => {
    onConfirm(selectedArchitect);
    resetFields();
    onHide();
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header
        closeButton
        onClick={resetFields}
        style={{
          padding: "14px",
        }}
      >
        <Modal.Title className="fw-bold" style={{ fontSize: "18px" }}>
          Architect
        </Modal.Title>
      </Modal.Header>
      <Modal.Body
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          alignItems: "flex-start",
          paddingLeft: "14px",
          paddingRight: "14px",
          overflowY: "scroll",
          height: "400px",
          paddingBottom: "2em",
        }}
      >
        {architects.map((architect, index) => {
          return (
            // Keyed by the architect's id, not the array index: React uses this
            // to match rows across re-renders. Without a key it warned and, more
            // importantly, could reuse the wrong row's DOM when the list changes
            // — which here means the selected radio button jumping to a
            // different architect. Falls back to the index only if an id is
            // missing.
            <div key={architect?._id ?? index} style={{ width: "100%" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <Typography component="p" className="fw-bold">
                    {architect?.name}
                  </Typography>
                  <Typography component="p">
                    {architect?.phoneNumber}
                  </Typography>
                  <Typography component="p">{architect?.email}</Typography>
                </div>
                <div>
                  <Checkbox
                    checked={selectedArchitect?._id === architect?._id}
                    sx={{
                      color: "#999",
                      "&.Mui-checked": {
                        color: '#414063',
                      },
                      "& .MuiSvgIcon-root": { fontSize: 22 },
                    }}
                    onChange={() => setSelectedArchitect(architect)}
                  />
                </div>
              </div>
              {index < architects?.length - 1 ? (
                <Divider
                  style={{
                    marginTop: "10px",
                    marginBottom: "10px",
                    width: "100%",
                    backgroundColor: "#ccc",
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </Modal.Body>
      <Modal.Footer className="bg-light">
        <Button
          variant="primary"
          disabled={!selectedArchitect}
          onClick={handleSave}
          style={{ minWidth: "130px" }}
        >
          Save
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default AssignArchitectModal;
