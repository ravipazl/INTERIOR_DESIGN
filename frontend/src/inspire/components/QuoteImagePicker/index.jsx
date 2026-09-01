import React, { useEffect, useMemo, useState } from "react";
import Modal from "react-bootstrap/Modal";
import { Button } from "react-bootstrap";
import "./index.css";

const imgSrc = (img) =>
  img?.url ? `${process.env.REACT_APP_UPLOADED_IMAGES_BASE_PATH}/${img.url}` : "";

const TYPE_LABEL = {
  uploaded: "Uploaded",
  edited: "Edited",
  generated: "Generated",
};

// Popup shown on "Request quote": one gallery of the project's Uploaded, Edited
// and Generated images with filter chips; the user picks ONE and sends it.
function QuoteImagePicker({
  show,
  onHide,
  generated = [],
  edited = [],
  uploaded = [],
  onSend,
  sending,
}) {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!show) {
      setSelected(null);
      setFilter("all");
    }
  }, [show]);

  // One combined list, each item tagged with its source type.
  const all = useMemo(
    () => [
      ...uploaded.map((i) => ({ ...i, _type: "uploaded" })),
      ...edited.map((i) => ({ ...i, _type: "edited" })),
      ...generated.map((i) => ({ ...i, _type: "generated" })),
    ],
    [uploaded, edited, generated]
  );

  const chips = [
    { key: "all", label: "All", count: all.length },
    { key: "uploaded", label: "Uploaded", count: uploaded.length },
    { key: "edited", label: "Edited", count: edited.length },
    { key: "generated", label: "Generated", count: generated.length },
  ];

  const visible = filter === "all" ? all : all.filter((i) => i._type === filter);
  const nothing = all.length === 0;

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="fs-16">Choose an image to send for quote</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {nothing ? (
          <p className="qip-empty m-0">
            Nothing yet — upload, generate or edit an image first.
          </p>
        ) : (
          <div className="qip-body">
            <div className="qip-filters">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`qip-chip ${filter === c.key ? "active" : ""}`}
                  onClick={() => setFilter(c.key)}
                  disabled={c.count === 0 && c.key !== "all"}
                >
                  {c.label}
                  <span className="qip-count">{c.count}</span>
                </button>
              ))}
            </div>

            <div className="qip-grid">
              {visible.map((img) => (
                <button
                  key={img._id}
                  type="button"
                  className={`qip-thumb ${selected?._id === img._id ? "sel" : ""}`}
                  onClick={() => setSelected(img)}
                  title={img.roomName || img.themeName || "image"}
                >
                  <img src={imgSrc(img)} alt={img.roomName || "image"} />
                  <span className="qip-badge">{TYPE_LABEL[img._type]}</span>
                  {selected?._id === img._id && <span className="qip-check">✓</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="outline"
          className="outline-button"
          onClick={onHide}
          disabled={sending}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          className="primary-button-filled"
          disabled={!selected || sending}
          onClick={() => onSend(selected)}
        >
          {sending ? "Sending…" : "Send for quote"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default QuoteImagePicker;
