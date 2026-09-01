import { RemoveRedEyeOutlined } from "@mui/icons-material";
import React from "react";
import { Button, Card } from "react-bootstrap";
import Eye from "../../assets/images/eye.svg";
import "./index.css";

export const DashboardCard = ({ title, subtitle, handleView, isSelected }) => {
  return (
    <Card
      className="m-2"
      bsPrefix={`shadow-inner-box ${isSelected ? "shadow-inner-box1" : ""}`}
    >
      <Card.Body>
        <Card.Subtitle className="text-muted ">{title}</Card.Subtitle>
        <Card.Title className="mt-3 project-count">{subtitle}</Card.Title>
        <Card.Footer className="border-0 d-flex justify-content-end m-2">
          <Button variant="link" onClick={handleView}>
            <img src={Eye} alt="Eye" className="eye-img" />
            View
          </Button>
        </Card.Footer>
      </Card.Body>
    </Card>
  );
};
