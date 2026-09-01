import React, { useEffect, useState } from "react";
import { Container, Modal } from "react-bootstrap";
import NoData from "../../assets/images/no_data.svg";
import TitleHeader from "../../components/TitleHeader";
import { listItems, fileUrl } from "../../services/projectWorkspaceService";
import { formatDate } from "../../utils/genericFunctions";

/**
 * RendersVideos — the client-facing gallery of photorealistic renders and orbit
 * videos the designer PUBLISHED from the 3D app. Both live in the design
 * backend's `project_items` collection (kind = "render" | "video").
 *
 * Read-only: clicking any card opens it full-size in an in-app modal (same
 * presentation as the BOQ screen) — images show large, videos play with
 * controls. Nothing is generated or edited here.
 */
function RendersVideos({ projectId, prefetched }) {
  const [renders, setRenders] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  // The item opened full-size in the modal: { kind, url, title } | null.
  const [preview, setPreview] = useState(null);
  // Items whose file failed to load (e.g. missing on disk) → show a clean
  // placeholder instead of a broken-image icon.
  const [failed, setFailed] = useState({});
  const markFailed = (id) => setFailed((f) => ({ ...f, [id]: true }));

  useEffect(() => {
    // Public quote page (no login) passes renders/videos already fetched from the
    // token endpoint (already published) — use them directly.
    if (prefetched) {
      setRenders(Array.isArray(prefetched.renders) ? prefetched.renders : []);
      setVideos(Array.isArray(prefetched.videos) ? prefetched.videos : []);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (!projectId) return;
      setLoading(true);
      const [r, v] = await Promise.all([
        listItems(projectId, "render"),
        listItems(projectId, "video"),
      ]);
      if (cancelled) return;
      // Only admin-approved (published) items reach the client. Renders an
      // architect submitted sit at status "pending_review" until an admin
      // approves them — those must never show here.
      const published = (arr) =>
        (Array.isArray(arr) ? arr : []).filter((i) => i.status === "published");
      setRenders(published(r));
      setVideos(published(v));
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, prefetched]);

  const openPreview = (item, kind) =>
    setPreview({
      kind,
      url: fileUrl(item.fileUrl),
      title: item.title || (kind === "video" ? "Render video" : "Render"),
    });

  const cardStyle = {
    borderRadius: "8px",
    marginRight: "10px",
    cursor: "pointer",
    objectFit: "cover",
    width: "220px",
    height: "150px",
    display: "block",
  };

  // Clean stand-in for a file that couldn't load (missing on disk).
  const placeholder = (label) => (
    <div
      style={{
        ...cardStyle,
        cursor: "default",
        objectFit: undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
        border: "1px dashed #d1d5db",
        color: "#9aa0ab",
        fontSize: "12px",
        textAlign: "center",
        padding: "10px",
      }}
    >
      <span style={{ fontSize: "20px", lineHeight: 1, marginBottom: "6px" }}>
        ⛰
      </span>
      {label}
    </div>
  );

  if (loading) {
    return (
      <Container
        fluid
        className="d-flex align-items-center justify-content-center"
        style={{ height: "calc(100vh - 160px)" }}
      >
        <p className="noData text-center">Loading renders & videos…</p>
      </Container>
    );
  }

  if (renders.length === 0 && videos.length === 0) {
    return (
      <Container
        fluid
        className="d-flex flex-column align-items-center justify-content-center"
        style={{ height: "calc(100vh - 160px)" }}
      >
        <img src={NoData} alt="no renders" width={"86px"} height={"109px"} />
        <p className="noData text-center mt-3">
          Your renders and videos will appear here once the design team
          publishes them.
        </p>
      </Container>
    );
  }

  return (
    <Container
      fluid
      style={{ paddingBottom: "144px", marginLeft: "14px", overflowX: "hidden" }}
    >
      <div style={{ borderBottom: "0.5px solid #bdbbc07d" }}>
        <div className="mt-3 p-0">
          <TitleHeader title="Render images" />
        </div>
        {renders.length > 0 ? (
          <div className="d-flex flex-row flex-wrap w-100 pt-3 ps-0">
            {renders.map((item) => (
              <div key={item._id} className="pb-2">
                {failed[item._id] ? (
                  placeholder("Preview unavailable")
                ) : (
                  <img
                    src={fileUrl(item.fileUrl)}
                    alt={item.title || "render"}
                    loading="lazy"
                    style={cardStyle}
                    onClick={() => openPreview(item, "render")}
                    onError={() => markFailed(item._id)}
                  />
                )}
                <div className="mr-2">
                  <p className="uploaded_time">{formatDate(item.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p
            className="noData"
            style={{ padding: "10px 0", color: "#8a8d9f", fontSize: 14 }}
          >
            No renders yet.
          </p>
        )}
      </div>

      <div>
        <div className="mt-3 p-0">
          <TitleHeader title="Render videos" />
        </div>
        {videos.length > 0 ? (
          <div className="d-flex flex-row flex-wrap w-100 pt-3 ps-0">
            {videos.map((item) => (
              <div key={item._id} className="pb-2">
                {failed[item._id] ? (
                  placeholder("Video unavailable")
                ) : (
                  <div
                    style={{ position: "relative", ...cardStyle, padding: 0 }}
                    onClick={() => openPreview(item, "video")}
                  >
                    <video
                      src={fileUrl(item.fileUrl)}
                      muted
                      playsInline
                      preload="metadata"
                      style={{ ...cardStyle, margin: 0, background: "#11131a" }}
                      onError={() => markFailed(item._id)}
                    />
                    {/* Play badge, so the still-looking thumbnail reads as a video. */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <span
                        style={{
                          width: 46,
                          height: 46,
                          borderRadius: "50%",
                          background: "rgba(0,0,0,0.55)",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 20,
                          paddingLeft: 3,
                        }}
                      >
                        ▶
                      </span>
                    </div>
                  </div>
                )}
                <div className="mr-2">
                  <p className="uploaded_time">{formatDate(item.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p
            className="noData"
            style={{ padding: "10px 0", color: "#8a8d9f", fontSize: 14 }}
          >
            No videos yet.
          </p>
        )}
      </div>

      {/* Full-size preview modal — same in-app presentation as the BOQ screen. */}
      <Modal
        show={!!preview}
        onHide={() => setPreview(null)}
        size="xl"
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 16 }}>{preview?.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ padding: 0, background: "#000" }}>
          {preview?.kind === "video" ? (
            <video
              src={preview.url}
              controls
              autoPlay
              playsInline
              style={{
                width: "100%",
                maxHeight: "80vh",
                display: "block",
                background: "#000",
              }}
            />
          ) : preview ? (
            <img
              src={preview.url}
              alt={preview.title}
              style={{
                width: "100%",
                maxHeight: "80vh",
                objectFit: "contain",
                display: "block",
              }}
            />
          ) : null}
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default RendersVideos;
