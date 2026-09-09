import React, { useState } from "react";
import "./index.css";
import Modal from "react-bootstrap/Modal";
import { Button } from "react-bootstrap";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import {
  EmailIcon,
  FacebookIcon,
  FacebookShareButton,
  TwitterIcon,
  TwitterShareButton,
  WhatsappIcon,
  WhatsappShareButton,
  EmailShareButton,
} from "react-share";
import { Input, Typography } from "@mui/material";
import Close from "../../assets/images/close.svg";

function ShareModal({ show, onHide, shareUrl }) {
  const [showCopiedInfo, setShowCopiedInfo] = useState(false);
  const base = "https://inspire.pazl.in";

  const handleShare = () => {
    navigator.clipboard.writeText(`${base}/share/${shareUrl}`);
    setShowCopiedInfo(true);
    setTimeout(() => {
      setShowCopiedInfo(false);
    }, [3000]);
  };

  const getShareUrl = () => {
    return `${base}/share/${shareUrl}`;
  };

  return (
    <>
      {/* dialogClassName scopes this component's CSS (index.css). Its
          `.modal-body` override used to be GLOBAL — every modal in the app
          picked it up. */}
      <Modal show={show} onHide={onHide} centered dialogClassName="share-modal">
        <Modal.Header className="bg-primary">
          <Modal.Title className="fs-16 text-white">Share</Modal.Title>
          <img src={Close} alt="close" style={{ cursor: "pointer" }} onClick={onHide} />
        </Modal.Header>
        <Modal.Body className="flex-column align-items-center">
          {showCopiedInfo ? (
            <div className="success-info">
              <CheckCircleOutlineIcon
                color="success"
                style={{ width: "5em", height: "5em" }}
              />
              <Typography component="h5" color="#2e7d32">
                Copied!
              </Typography>
            </div>
          ) : (
            <>
              <div className="button-body">
                <Input type="text" className="w-75" value={getShareUrl()} readOnly />
                <Button
                  variant="secondary"
                  onClick={handleShare}
                  className="coy-button"
                >
                  Copy Link
                </Button>
              </div>
              <div className="button-body">
                <FacebookShareButton url={getShareUrl()}>
                  <FacebookIcon size={34} round={true} />
                </FacebookShareButton>
                <TwitterShareButton url={getShareUrl()}>
                  <TwitterIcon size={34} round={true} />
                </TwitterShareButton>
                <WhatsappShareButton url={getShareUrl()}>
                  <WhatsappIcon size={34} round={true} />
                </WhatsappShareButton>
                <EmailShareButton url={getShareUrl()}>
                  <EmailIcon size={34} round={true} />
                </EmailShareButton>
              </div>
            </>
          )}
        </Modal.Body>
      </Modal>
    </>
  );
}
export default ShareModal;
