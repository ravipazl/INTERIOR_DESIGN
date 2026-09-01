import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ProjectWorkspaceService,
  ProjectItem,
  resolveFileUrl,
} from "@pazl/services/ProjectWorkspaceService";
import { AuthService } from "@pazl/services/authService";
import { ProjectsService } from "@pazl/services/projectsService";
import Toast, { ToastState } from "../Toast";

/**
 * RenderHistory — the team's render history for one project, shown on the
 * Production page (the Production tab in the 3D editor, next to the BOQ). Every
 * render/video made in the editor is auto-saved here as a draft; this is where
 * the team reviews all of them and chooses which to send:
 *
 *   architect → selects drafts → "Send to admin"     (status pending_review, admin emailed)
 *   admin     → selects any     → "Publish to client" (status published, client sees it)
 *
 * Read/patched through the same projectitems pipeline as the rest of the
 * workspace. Team-only — the editor is not reachable by clients.
 */

type Props = {
  projectId?: string;
  activeTab?: string;
  // Pulls the BOQ as a PDF Blob from the BoqTable above, to attach to the
  // architect's approval email. Provided by ProductionMenu.
  getBoqPdf?: () => Promise<Blob | null>;
};

const RenderHistory: React.FC<Props> = ({
  projectId,
  activeTab,
  getBoqPdf,
}) => {
  const role = (AuthService.getCurrentUser() as any)?.permissions;
  const isAdmin = role === "admin" || role === "super_admin";

  const [items, setItems] = useState<ProjectItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // BOQ PDF preview shown BEFORE the send/email fires (Send to admin / Send to
  // client). previewOpen toggles the modal; boqPreviewUrl is the object URL for
  // the iframe; boqBlob is reused as the email attachment so what you preview is
  // exactly what's sent; preparing = the PDF is being built.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [boqPreviewUrl, setBoqPreviewUrl] = useState<string | null>(null);
  const [boqBlob, setBoqBlob] = useState<Blob | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Email-composer fields shown on the Send screen (Cc / Subject / Message) and
  // the sender's extra attachments (2D diagram, docs…). projectName/clientEmail
  // are captured on load just to label the composer.
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [projectName, setProjectName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  // The admin recipient emails, shown in the To field on the architect's "Send
  // to admin" composer (fetched once; falls back to a label if unavailable).
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  // The project's quote status + whether the client raised a change request.
  // Together they decide whether the admin's "Send to client" is disabled while
  // waiting for the client to respond to a sent quote.
  const [projectStatus, setProjectStatus] = useState<string>("");
  const [changeRequestPending, setChangeRequestPending] = useState(false);
  // The item shown full-size in the preview overlay (image or playable video),
  // so the team can actually SEE a render before selecting it. Null = closed.
  const [preview, setPreview] = useState<ProjectItem | null>(null);
  // Items whose file failed to load (e.g. missing on disk) → show a clean
  // placeholder instead of a broken-image icon.
  // Seen (opened) renders — persisted so the NEW badge disappears once a render
  // is opened, and stays gone across reloads (mark-as-read).
  const SEEN_KEY = "pazl-render-seen";
  const [seen, setSeen] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });
  const markSeen = (id?: string) => {
    if (!id) return;
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* storage disabled / full — the badge just won't persist */
      }
      return next;
    });
  };
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const markFailed = (id?: string) => {
    if (!id) return;
    setFailed((f) => ({ ...f, [id]: true }));
    // An unavailable file can't be sent — drop it from the selection if it was
    // already ticked before it failed to load.
    setSelected((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  };
  // The app's shared toast (see components/Toast) — confirmation after a send.
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (text: string, type: "success" | "error") => {
    setToast({ type, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  // `quiet` = update the cards IN PLACE without flipping the section into its
  // "Loading…" state (which blanks the grid and reads like a reload). The manual
  // Refresh, the tab-switch reload, and the "render saved" event all use quiet so
  // only the card grid re-renders — nothing else on the page moves. The first
  // mount uses the loading state so an empty section shows "Loading…" once.
  const load = useCallback(
    async (quiet = false) => {
      if (!projectId) return;
      if (!quiet) setLoading(true);
      try {
        const [renders, videos, project] = await Promise.all([
          ProjectWorkspaceService.list(projectId, "render"),
          ProjectWorkspaceService.list(projectId, "video"),
          ProjectsService.getProjectById(projectId).catch(() => null),
        ]);
        // Newest first, across both kinds.
        const all = [...renders, ...videos].sort((a, b) =>
          (b.createdAt || "").localeCompare(a.createdAt || "")
        );
        setItems(all);
        setProjectStatus((project as any)?.status ?? "");
        setChangeRequestPending(!!(project as any)?.changeRequestPending);
        setProjectName((project as any)?.name ?? "");
        // The client's email usually lives on the OWNER account, not the project
        // row (project.clientEmail is often blank) — same fallback the design
        // ProjectDetail and the send-quote backend use.
        setClientEmail(
          (project as any)?.clientEmail ||
            (project as any)?.ownerUser?.email ||
            ""
        );
        // A quiet refresh keeps the user's current selection; a full load
        // (mount / after send) starts clean. Publishing is ADDITIVE, so you tick
        // only the NEW renders to share this round — already-shared renders stay
        // in the client's history and never need re-ticking.
        if (!quiet) setSelected(new Set());
      } catch (e) {
        console.error("RenderHistory.load", e);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Architect composer: fetch the admin recipient emails once, to show the real
  // "To" address(es). Best-effort — falls back to a label if it can't list them.
  useEffect(() => {
    if (isAdmin) return;
    let cancelled = false;
    (async () => {
      const admins = await AuthService.getAllAdminUsers();
      if (!cancelled && Array.isArray(admins)) {
        setAdminEmails(
          admins.map((u: any) => u?.email).filter(Boolean) as string[]
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // The Production tab stays mounted (it's just hidden when you leave it), so a
  // mount-only load goes stale: a render/video made AFTER this first loaded —
  // e.g. the orbit video, which you make after the photo — never appeared.
  // Reload each time the user switches back INTO the Production tab so the whole
  // render history (photos AND videos) is current.
  const prevTab = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      activeTab === "production" &&
      prevTab.current &&
      prevTab.current !== "production"
    ) {
      load(true);
    }
    prevTab.current = activeTab;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // The render panel broadcasts this the moment it auto-saves a render/video, so
  // the history refreshes even when a render is made while the Production tab is
  // already open (no tab switch to trigger the reload above).
  useEffect(() => {
    const onSaved = () => load(true);
    window.addEventListener("pazl:render-saved", onSaved);
    return () => window.removeEventListener("pazl:render-saved", onSaved);
  }, [load]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const toggle = (id?: string) => {
    if (!id || failed[id]) return; // an unavailable file can never be selected
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // What the admin SEES is only what was submitted to them (or already
  // published) — never the architect's private drafts. The architect keeps
  // seeing all of their own renders (drafts included).
  const visibleItems = isAdmin
    ? items.filter((i) => i.status !== "draft")
    : items;
  // Partition the gallery into Images and Videos.
  const imageItems = visibleItems.filter((i) => i.kind !== "video");
  const videoItems = visibleItems.filter((i) => i.kind === "video");

  // One card renderer, reused by both the Images and the Videos section.
  const renderCard = (item: ProjectItem) => {
    const isSel = !!item._id && selected.has(item._id);
    const isVideo = item.kind === "video";
    const src = resolveFileUrl(item.fileUrl);
    // A file that failed to load can't be sent, so it's not selectable.
    const isUnavailable = !!item._id && !!failed[item._id as string];
    // "New" = created within the last 24h, so the team can tell fresh renders
    // apart from older ones at a glance.
    const isNew =
      !!item.createdAt &&
      !seen.has(item._id as string) &&
      Date.now() - new Date(item.createdAt).getTime() < 24 * 60 * 60 * 1000;
    return (
      <div
        key={item._id}
        onClick={() => {
          setPreview(item);
          markSeen(item._id); // opening a render clears its NEW badge
        }}
        title="Click to preview"
        style={{
          border: isSel ? "2px solid #059669" : "1px solid #e5e7eb",
          borderRadius: 8,
          overflow: "hidden",
          cursor: "pointer",
          background: "#fff",
        }}
      >
        <div style={{ position: "relative" }}>
          {failed[item._id as string] ? (
            <div
              style={{
                width: "100%",
                height: 130,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "#f3f4f6",
                border: "1px dashed #d1d5db",
                color: "#9aa0ab",
                fontSize: 12,
                textAlign: "center",
                padding: 8,
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1, marginBottom: 4 }}>⛰</span>
              {isVideo ? "Video unavailable" : "Preview unavailable"}
            </div>
          ) : isVideo ? (
            <video
              src={src}
              muted
              playsInline
              preload="metadata"
              onError={() => markFailed(item._id)}
              style={{
                width: "100%",
                height: 130,
                objectFit: "cover",
                background: "#11131a",
                display: "block",
              }}
            />
          ) : (
            <img
              src={src}
              alt={item.title || "render"}
              loading="lazy"
              onError={() => markFailed(item._id)}
              style={{
                width: "100%",
                height: 130,
                objectFit: "cover",
                background: "#f3f4f6",
                display: "block",
              }}
            />
          )}
          {isVideo && !failed[item._id as string] && (
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
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  paddingLeft: 3,
                }}
              >
                ▶
              </div>
            </div>
          )}
          <input
            type="checkbox"
            checked={isSel && !isUnavailable}
            disabled={isUnavailable}
            onChange={() => toggle(item._id)}
            onClick={(e) => e.stopPropagation()}
            title={
              isUnavailable ? "File unavailable — can't be sent" : "Select to send"
            }
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              width: 18,
              height: 18,
              cursor: isUnavailable ? "not-allowed" : "pointer",
              opacity: isUnavailable ? 0.5 : 1,
            }}
          />
          {isNew && (
            <span
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: 0.4,
                padding: "2px 7px",
                borderRadius: 10,
                background: "#059669",
                color: "#fff",
              }}
            >
              NEW
            </span>
          )}
          <span
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 12,
              background: isVideo ? "#111827" : "#e0e7ff",
              color: isVideo ? "#fff" : "#3730a3",
            }}
          >
            {isVideo ? "▶ Video" : "Image"}
          </span>
        </div>
        <div style={{ padding: "6px 8px" }}>
          <div
            style={{
              fontSize: 12,
              color: "#374151",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={item.title}
          >
            {item.title || (isVideo ? "Render video" : "Render")}
          </div>
          {item.createdBy && (
            <div style={{ fontSize: 10.5, color: "#9ca3af" }}>by {item.createdBy}</div>
          )}
        </div>
      </div>
    );
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 12,
    // Scroll WITHIN the section once there are many items, so a large gallery
    // doesn't push the page (and the Send button) endlessly far down.
    maxHeight: 470,
    overflowY: "auto",
    paddingRight: 4,
  };

  // Attachment THUMBNAIL tile in the email composer.
  const thumbTile: React.CSSProperties = {
    position: "relative",
    width: 84,
    height: 62,
    borderRadius: 6,
    overflow: "hidden",
    border: "1px solid #e0e7ff",
    background: "#f3f4f6",
    padding: 0,
    cursor: "pointer",
    flex: "0 0 auto",
  };
  const thumbImg: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  };
  const thumbBadge: React.CSSProperties = {
    position: "absolute",
    left: 4,
    bottom: 3,
    fontSize: 10,
    fontWeight: 600,
    color: "#fff",
    background: "rgba(0,0,0,0.55)",
    borderRadius: 3,
    padding: "0 5px",
    pointerEvents: "none",
  };

  const selectedItems = items.filter((i) => i._id && selected.has(i._id));
  // Architect can only push drafts forward; admin can publish anything not yet
  // published. Publishing is ADDITIVE — a render shared in an earlier round stays
  // shared, so the client keeps the full render/video history across every change.
  const eligible = isAdmin
    ? selectedItems.filter((i) => i.status !== "published")
    : selectedItems.filter((i) => i.status === "draft");

  // ONE action sends the whole package. For the architect, "Send to admin"
  // submits the BOQ + the selected renders together: it patches the renders to
  // pending_review AND marks the project pending approval (the old "Design
  // Complete") — so there is no longer a separate design-complete button. For
  // the admin, "Publish to client" publishes the selected renders.
  const send = async (boqPdf?: Blob | null) => {
    const boqFile = boqPdf
      ? new File([boqPdf], "BOQ.pdf", { type: "application/pdf" })
      : undefined;
    // Both roles can proceed with no renders selected — the admin still sends
    // the quote, the architect still submits the BOQ. (Old guard removed: it
    // blocked the admin's "Send to client" whenever nothing was ticked.)
    setBusy(true);
    try {
      if (isAdmin) {
        // Admin's single action: publish the selected renders/videos AND send the
        // quote to the client. NO BOQ PDF is built here — rasterising the BOQ ran
        // inside the memory-heavy 3D editor and crashed the tab. The client reviews
        // the full styled BOQ in their in-app BOQ tab; the email carries the
        // selected renders (large videos are linked by the backend).
        // Publish the ticked renders/videos. ADDITIVE: previously-published
        // renders stay published, so the client keeps every render/video from
        // earlier rounds (the full history) — this send only ADDS the new ones.
        const published = eligible.length;
        if (published) {
          await Promise.all(
            eligible
              .filter((i) => i._id)
              .map((i) =>
                ProjectWorkspaceService.update(i._id as string, {
                  status: "published",
                })
              )
          );
        }
        let quote:
          | {
              sent?: boolean;
              to?: string;
              error?: string;
              whatsapp?: {
                sent?: boolean;
                skipped?: boolean;
                reason?: string;
                to?: string;
                error?: string;
              };
            }
          | null = null;
        if (projectId) {
          const imageUrls = selectedItems
            .filter((i) => i.kind === "render" && i.fileUrl)
            .map((i) => i.fileUrl as string);
          const videoUrls = selectedItems
            .filter((i) => i.kind === "video" && i.fileUrl)
            .map((i) => i.fileUrl as string);
          quote = await ProjectWorkspaceService.sendQuote(projectId, boqFile, {
            imageUrls,
            videoUrls,
            subject: subject.trim() || undefined,
            message: message.trim() || undefined,
            cc: cc.trim() || undefined,
            attachments: extraFiles,
          });
          if (quote?.sent) {
            await ProjectsService.updateProject(projectId, {
              status: "quotation_sent",
            });
          }
        }
        await load(true);
        setSelected(new Set());
        if (quote && !quote.sent) {
          showToast(
            quote.error
              ? `Couldn't send the quote: ${quote.error}`
              : "Couldn't send the quote.",
            "error"
          );
        } else if (quote?.sent) {
          // Append what happened on WhatsApp so the sender sees both channels.
          const wa = quote.whatsapp;
          const waMsg = wa?.sent
            ? ` · WhatsApp sent to +${wa.to}`
            : wa?.skipped && wa.reason === "no_phone"
            ? " · WhatsApp skipped — no valid phone"
            : wa && !wa.sent && !wa.skipped
            ? " · WhatsApp failed"
            : "";
          showToast(
            (published
              ? `Renders published and quote sent to ${quote.to}.`
              : `Quote sent to ${quote.to}.`) + waMsg,
            "success"
          );
        } else {
          showToast(published ? "Published to the client." : "Nothing to send.", "success");
        }
      } else {
        // Architect: email the admins the selected render images/videos so they
        // can review and publish. NO BOQ PDF is built here (it crashed the editor
        // tab); the admin reviews the BOQ on the Production page. ONLY if the mail
        // goes out do we mark the renders pending review and the project pending
        // approval — so a failed email doesn't silently move the project forward.
        // Attach EVERYTHING the user ticked — regardless of status (a render
        // already "pending review" must still be attachable).
        const imageUrls = selectedItems
          .filter((i) => i.kind === "render" && i.fileUrl)
          .map((i) => i.fileUrl as string);
        const videoUrls = selectedItems
          .filter((i) => i.kind === "video" && i.fileUrl)
          .map((i) => i.fileUrl as string);
        const user = AuthService.getCurrentUser() as any;
        const mail = await ProjectWorkspaceService.submitForApproval({
          projectId: projectId as string,
          pdf: boqFile,
          imageUrls,
          videoUrls,
          submittedBy: user?.email || user?.name,
          subject: subject.trim() || undefined,
          message: message.trim() || undefined,
          cc: cc.trim() || undefined,
          attachments: extraFiles,
        });
        if (!mail?.sent) {
          showToast(
            mail?.error
              ? `Couldn't send: ${mail.error}`
              : "Couldn't send the email. Please try again.",
            "error"
          );
          return;
        }
        // Submit the ticked drafts for review. ADDITIVE: renders submitted in an
        // earlier round stay in the admin's review list — this only ADDS the newly
        // ticked drafts.
        await Promise.all(
          eligible
            .filter((i) => i._id)
            .map((i) =>
              ProjectWorkspaceService.update(i._id as string, {
                status: "pending_review",
              })
            )
        );
        if (
          projectId &&
          projectStatus !== "quotation_pending_approval" &&
          projectStatus !== "closed"
        ) {
          await ProjectsService.updateProject(projectId, {
            status: "quotation_pending_approval",
          });
        }
        await load(true);
        setSelected(new Set());
        const linked = mail.linkedVideos?.length || 0;
        const extra = linked
          ? ` (${linked} large video${linked > 1 ? "s" : ""} linked, not attached)`
          : "";
        showToast(`Sent to the admin for review${extra}.`, "success");
      }
    } catch (e) {
      console.error("RenderHistory.send", e);
      showToast("Couldn't send. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  // The Send button doesn't send straight away: it builds the BOQ PDF and opens
  // the EMAIL COMPOSER pre-loaded with the BOQ + selected renders/videos, so the
  // sender can set Cc / subject / message and attach extra files before sending.
  const openSendPreview = async () => {
    // Prefill the composer fresh each time it opens.
    setCc("");
    setExtraFiles([]);
    setSubject(
      isAdmin
        ? `Your quotation${projectName ? ` for ${projectName}` : ""}`
        : `Quote pending approval${projectName ? ` — ${projectName}` : ""}`
    );
    setMessage("");
    setPreparing(true);
    let blob: Blob | null = null;
    try {
      blob = (getBoqPdf ? await getBoqPdf() : null) || null;
    } catch (e) {
      console.error("BOQ preview build failed", e);
    }
    setPreparing(false);
    setBoqBlob(blob);
    setBoqPreviewUrl(blob ? URL.createObjectURL(blob) : null);
    setPreviewOpen(true);
  };

  const closeSendPreview = () => {
    if (boqPreviewUrl) URL.revokeObjectURL(boqPreviewUrl);
    setBoqPreviewUrl(null);
    setBoqBlob(null);
    setPreviewOpen(false);
  };

  // Confirm from the modal → run the real send with the previewed BOQ attached.
  const confirmSend = async () => {
    await send(boqBlob);
    closeSendPreview();
  };

  // After the admin sends the quote, the button is disabled until the client
  // responds — i.e. while the status is "quotation_sent" and no change request
  // has come back. A client change request (or acceptance moving the status on)
  // re-enables it so the admin can send a revised quote.
  const awaitingClient =
    isAdmin && projectStatus === "quotation_sent" && !changeRequestPending;
  const actionLabel = isAdmin
    ? awaitingClient
      ? "Awaiting client response"
      : "Send to client"
    : "Send to admin";
  // Shown on the button WHILE the send (incl. the email) is in flight, so the
  // action clearly reads as working and the send is confirmed by the toast after.
  const sendingLabel = isAdmin ? "Sending to client…" : "Sending to admin…";
  // Both single buttons also carry the quote, so they stay enabled even with no
  // renders ticked (admin can send the quote alone; architect can submit the
  // BOQ alone) — except while awaiting the client's response to a sent quote.
  const disabled = busy || awaitingClient;

  return (
    <div className="bg-white rounded m-2 p-4 shadow-md shadow-[#00000026] dark:bg-[#333333]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-[#414063] dark:text-white">
            Renders &amp; videos
          </h2>
          {!isAdmin && projectStatus === "quotation_pending_approval" && (
            <span
              className="text-xs px-2 py-1 rounded"
              style={{ background: "#fff7ed", color: "#9a3412" }}
            >
              Pending approval
            </span>
          )}
          {awaitingClient && (
            <span
              className="text-xs px-2 py-1 rounded"
              style={{ background: "#eef6ff", color: "#1e40af" }}
            >
              Quote sent — awaiting client
            </span>
          )}
        </div>
        <button
          className="px-3 py-2 rounded border border-[#d1d5db] text-sm text-[#414063] dark:text-white"
          onClick={() => load(true)}
          disabled={busy}
          title="Refresh the render history"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[#6b7280]">Loading renders…</p>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-[#6b7280]">
          {isAdmin
            ? "No renders have been submitted for review yet."
            : "No renders yet. Create a render in the editor and it will appear here automatically."}
        </p>
      ) : (
        <>
          {/* Both sections always show once ANY item exists, so an empty one reads
              as "none yet" instead of silently disappearing. */}
          <div style={{ marginBottom: 6 }}>
            <div
              style={{
                fontWeight: 600,
                color: "#374151",
                fontSize: 14,
                margin: "6px 0",
              }}
            >
              Images{" "}
              <span style={{ color: "#9ca3af", fontWeight: 400 }}>
                ({imageItems.length})
              </span>
            </div>
            {imageItems.length > 0 ? (
              <div style={gridStyle}>{imageItems.map(renderCard)}</div>
            ) : (
              <p className="text-sm text-[#9ca3af]" style={{ margin: "4px 0" }}>
                No renders yet.
              </p>
            )}
          </div>
          <div>
            <div
              style={{
                fontWeight: 600,
                color: "#374151",
                fontSize: 14,
                margin: "14px 0 6px",
              }}
            >
              Videos{" "}
              <span style={{ color: "#9ca3af", fontWeight: 400 }}>
                ({videoItems.length})
              </span>
            </div>
            {videoItems.length > 0 ? (
              <div style={gridStyle}>{videoItems.map(renderCard)}</div>
            ) : (
              <p className="text-sm text-[#9ca3af]" style={{ margin: "4px 0" }}>
                No videos yet.
              </p>
            )}
          </div>
        </>
      )}

      {/* Send button — placed AFTER the render/video cards, so you review the
          renders first and then send. (Refresh stays in the header above.) */}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button
          className="px-4 py-2 rounded text-sm text-white"
          style={{
            background: disabled || preparing ? "#9ca3af" : "#059669",
            cursor: disabled || preparing ? "default" : "pointer",
          }}
          onClick={openSendPreview}
          disabled={disabled || preparing}
          title={
            isAdmin
              ? awaitingClient
                ? "The quote has been sent — waiting for the client to respond (accept or request a change)."
                : "Preview the BOQ, then publish the selected renders AND email the quote to the client"
              : "Preview the BOQ, then submit it with the selected renders to the admin"
          }
        >
          {preparing ? "Preparing BOQ…" : busy ? sendingLabel : actionLabel}
        </button>
      </div>

      {/* Full-size preview overlay: images show large; videos play with
          controls. Click the backdrop or × to close. */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              background: "#fff",
              borderRadius: 10,
              overflow: "hidden",
              maxWidth: "92vw",
              maxHeight: "92vh",
            }}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              title="Close"
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                zIndex: 1,
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "none",
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                fontSize: 18,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
            {preview.kind === "video" ? (
              <video
                src={resolveFileUrl(preview.fileUrl)}
                controls
                autoPlay
                playsInline
                style={{
                  display: "block",
                  maxWidth: "92vw",
                  maxHeight: "84vh",
                  background: "#000",
                }}
              />
            ) : (
              <img
                src={resolveFileUrl(preview.fileUrl)}
                alt={preview.title || "render"}
                style={{
                  display: "block",
                  maxWidth: "92vw",
                  maxHeight: "84vh",
                }}
              />
            )}
            <div
              style={{
                padding: "8px 12px",
                fontSize: 13,
                color: "#374151",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: preview.kind === "video" ? "#111827" : "#e0e7ff",
                  color: preview.kind === "video" ? "#fff" : "#3730a3",
                }}
              >
                {preview.kind === "video" ? "▶ Video" : "Image"}
              </span>
              {preview.title ||
                (preview.kind === "video" ? "Render video" : "Render")}
            </div>
          </div>
        </div>
      )}

      {/* Email composer shown on Send: BOQ + selected renders/videos are pre-
          attached; the sender sets Cc / subject / message and can attach extra
          files (a 2D diagram, docs…) before it goes out. */}
      {previewOpen && (
        <div
          onClick={busy ? undefined : closeSendPreview}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 10,
              overflow: "hidden",
              width: "min(680px, 94vw)",
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #e5e7eb",
                fontWeight: 600,
                color: "#414063",
              }}
            >
              {isAdmin ? "Email the client" : "Email the admin"}
              {projectName ? ` — ${projectName}` : ""}
            </div>

            <div
              style={{
                padding: "14px 16px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* To — fixed / read-only */}
              <div style={{ fontSize: 13, color: "#374151" }}>
                <span style={{ color: "#6b7280" }}>To:&nbsp;</span>
                <span style={{ fontWeight: 600 }}>
                  {isAdmin
                    ? clientEmail || "The client"
                    : adminEmails.length
                    ? adminEmails.join(", ")
                    : "PAZL admin team"}
                </span>
              </div>

              <label style={{ fontSize: 12, color: "#6b7280" }}>
                Cc (optional)
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="architect@pazl.info, colleague@pazl.info"
                  disabled={busy}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    fontSize: 13,
                    color: "#111827",
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                    boxSizing: "border-box",
                  }}
                />
              </label>

              <label style={{ fontSize: 12, color: "#6b7280" }}>
                Subject
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={busy}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    fontSize: 13,
                    color: "#111827",
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                    boxSizing: "border-box",
                  }}
                />
              </label>

              <label style={{ fontSize: 12, color: "#6b7280" }}>
                Message (optional)
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write a note to accompany the quote…"
                  disabled={busy}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    fontSize: 13,
                    color: "#111827",
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
              </label>

              {/* Attachments — BOQ + selected renders/videos (auto) + extras */}
              <div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                  Attachments
                </div>
                <div
                  style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                >
                  {/* BOQ — click to open the PDF in a new tab. */}
                  {boqBlob ? (
                    <button
                      type="button"
                      onClick={() =>
                        boqPreviewUrl &&
                        window.open(boqPreviewUrl, "_blank", "noopener")
                      }
                      style={thumbTile}
                      title="Open the BOQ PDF"
                    >
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "#fee2e2",
                          color: "#991b1b",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        PDF
                      </div>
                      <span style={thumbBadge}>BOQ</span>
                    </button>
                  ) : (
                    <div style={{ ...thumbTile, cursor: "default" }}>
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#9ca3af",
                          fontSize: 10,
                          textAlign: "center",
                          padding: 4,
                        }}
                      >
                        BOQ n/a
                      </div>
                    </div>
                  )}

                  {/* Each selected render/video — thumbnail, click to preview. */}
                  {selectedItems.map((it) => (
                    <button
                      key={`att-${it._id}`}
                      type="button"
                      onClick={() => !failed[it._id as string] && setPreview(it)}
                      style={thumbTile}
                      title={
                        it.title ||
                        (it.kind === "video" ? "Render video" : "Render")
                      }
                    >
                      {failed[it._id as string] ? (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#9ca3af",
                            fontSize: 10,
                          }}
                        >
                          N/A
                        </div>
                      ) : it.kind === "video" ? (
                        <>
                          <video
                            src={resolveFileUrl(it.fileUrl)}
                            muted
                            playsInline
                            preload="metadata"
                            style={{ ...thumbImg, background: "#11131a" }}
                            onError={() => markFailed(it._id)}
                          />
                          <span style={thumbBadge}>▶ Video</span>
                        </>
                      ) : (
                        <img
                          src={resolveFileUrl(it.fileUrl)}
                          alt={it.title || "render"}
                          style={thumbImg}
                          onError={() => markFailed(it._id)}
                        />
                      )}
                    </button>
                  ))}

                  {/* The sender's extra files — tile, click to open, × to remove. */}
                  {extraFiles.map((f, i) => (
                    <div key={`${f.name}-${i}`} style={thumbTile}>
                      <div
                        onClick={() =>
                          window.open(
                            URL.createObjectURL(f),
                            "_blank",
                            "noopener"
                          )
                        }
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#3730a3",
                          fontSize: 10,
                          textAlign: "center",
                          padding: "4px 4px 14px",
                          overflow: "hidden",
                          wordBreak: "break-word",
                        }}
                        title={`Open ${f.name}`}
                      >
                        {f.name}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setExtraFiles((prev) =>
                            prev.filter((_, idx) => idx !== i)
                          )
                        }
                        disabled={busy}
                        title="Remove"
                        style={{
                          position: "absolute",
                          top: 2,
                          right: 2,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          border: "none",
                          background: "rgba(0,0,0,0.55)",
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: 13,
                          lineHeight: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
                  <label
                    style={{
                      fontSize: 13,
                      color: "#1e88e5",
                      cursor: busy ? "default" : "pointer",
                    }}
                  >
                    + Attach file
                    <input
                      type="file"
                      multiple
                      disabled={busy}
                      onChange={(e) => {
                        const picked = Array.from(e.target.files || []);
                        if (picked.length)
                          setExtraFiles((prev) => [...prev, ...picked]);
                        e.target.value = "";
                      }}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: "12px 16px",
                borderTop: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                onClick={closeSendPreview}
                disabled={busy}
                className="px-4 py-2 rounded border border-[#d1d5db] text-sm text-[#414063]"
              >
                Cancel
              </button>
              <button
                onClick={confirmSend}
                disabled={busy}
                className="px-4 py-2 rounded text-sm text-white"
                style={{ background: busy ? "#9ca3af" : "#059669" }}
              >
                {busy
                  ? sendingLabel
                  : isAdmin
                  ? "Send to client"
                  : "Send to admin"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation toast after a send — the app's shared toast. */}
      <Toast toast={toast} />
    </div>
  );
};

export default RenderHistory;
