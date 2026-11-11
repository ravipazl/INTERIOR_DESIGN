import React, { useEffect, useState } from "react";
import { Container, Modal } from "react-bootstrap";
import NoData from "../../assets/images/no_data.svg";
import TitleHeader from "../../components/TitleHeader";
import { listItemsPage, fileUrl } from "../../services/projectWorkspaceService";
import { formatDate } from "../../utils/genericFunctions";
import { TablePager } from "../../components/PzTable";
import { usePaging } from "../../components/ProjectWorkspace/paging";
import "../../components/ProjectWorkspace/pager.css";

/**
 * RendersVideos — the client-facing gallery of photorealistic renders and orbit
 * videos the designer PUBLISHED from the 3D app. Both live in the design
 * backend's `project_items` collection (kind = "render" | "video").
 *
 * Read-only: clicking any card opens it full-size in an in-app modal (same
 * presentation as the BOQ screen) — images show large, videos play with
 * controls. Nothing is generated or edited here.
 *
 * Each grid pages on its own (Rows per page remembered in this browser): the
 * app fetches one page of published items at a time from the server; the
 * public quote page, which arrives with its items already, pages them here.
 */
function RendersVideos({ projectId, prefetched }) {
  const [renders, setRenders] = useState([]);
  const [videos, setVideos] = useState([]);
  const [renderTotal, setRenderTotal] = useState(0);
  const [videoTotal, setVideoTotal] = useState(0);
  const rp = usePaging("render");
  const vp = usePaging("video");
  const [loading, setLoading] = useState(true);
  // The item opened full-size in the modal: { kind, url, title } | null.
  const [preview, setPreview] = useState(null);
  // Items whose file failed to load (e.g. missing on disk) → show a clean
  // placeholder instead of a broken-image icon.
  const [failed, setFailed] = useState({});
  const markFailed = (id) => setFailed((f) => ({ ...f, [id]: true }));

  // One page of one grid. Only admin-approved (published) items reach the
  // client: renders an architect submitted sit at "pending_review" until an
  // admin approves them, and must never show here — the server filters them.
  const loadGrid = async (kind, paging, setList, setTotal) => {
    if (prefetched) {
      const all = Array.isArray(prefetched[kind === "render" ? "renders" : "videos"])
        ? prefetched[kind === "render" ? "renders" : "videos"]
        : [];
      const from = (paging.page - 1) * paging.rows;
      setList(all.slice(from, from + paging.rows));
      setTotal(all.length);
      return;
    }
    if (!projectId) return;
    const res = await listItemsPage(projectId, kind, {
      limit: paging.rows,
      skip: (paging.page - 1) * paging.rows,
      status: "published",
    });
    setList(res.items);
    setTotal(res.total);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadGrid("render", rp, (l) => !cancelled && setRenders(l), (t) => !cancelled && setRenderTotal(t));
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, prefetched, rp.page, rp.rows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadGrid("video", vp, (l) => !cancelled && setVideos(l), (t) => !cancelled && setVideoTotal(t));
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, prefetched, vp.page, vp.rows]);

  const pager = (paging, total) =>
    total > 0 ? (
      <TablePager
        rowsPerPage={paging.rows}
        rowCount={total}
        currentPage={paging.page}
        onChangePage={(p) => paging.setPage(p)}
        onChangeRowsPerPage={paging.setRows}
      />
    ) : null;

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

  if (renderTotal === 0 && videoTotal === 0) {
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
      className="pz-rv"
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
        {pager(rp, renderTotal)}
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
        {pager(vp, videoTotal)}
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
