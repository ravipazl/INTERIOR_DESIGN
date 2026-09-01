import axios from "./apiService";
import { AuthService } from "./authService";

/**
 * ProjectWorkspaceService — the per-project workspace (documents/media, change
 * requests, tasks, discussions). All rows live in one `projectitems` collection
 * keyed by projectId + kind. Files (PDF/image/audio) upload to
 * /project-file-upload and the returned URL is stored on the item.
 */

const auth = () => ({
  headers: { Authorization: `${AuthService.getAccessToken()}` },
});

const asArray = (res: any): any[] => {
  const body = res?.data;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
};
const ok = (res: any) => res?.status >= 200 && res?.status < 300;

export type ItemKind =
  | "document"
  | "change"
  | "task"
  | "discussion"
  | "stage_event"
  // Published design deliverables the client sees on PAZL web: a photoreal
  // render still and an orbit video. Both reference the existing
  // /uploads/renders/<id> file, so publishing records a URL — it never re-uploads.
  | "render"
  | "video";

// Files are served by the design BACKEND (3334); prefix relative URLs with it.
export const resolveFileUrl = (url?: string): string => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${process.env.REACT_APP_API_BASE_URL ?? ""}${url}`;
};

export interface ProjectItem {
  _id?: string;
  projectId: string;
  kind: ItemKind;
  // document
  type?: string;
  title?: string;
  fileUrl?: string;
  mimeType?: string;
  note?: string;
  // change
  description?: string;
  status?: string;
  resolution?: string;
  attachmentUrl?: string;
  // task
  assignedTo?: string;
  dueDate?: string;
  completedAt?: string;
  // discussion
  text?: string;
  author?: string;
  // stage_event (project tracker)
  stage?: string;
  expectedDate?: string;
  by?: string;
  auto?: boolean;
  createdBy?: string;
  createdAt?: string;
}

export const ProjectWorkspaceService = {
  list: async (projectId: string, kind: ItemKind): Promise<ProjectItem[]> => {
    try {
      return asArray(
        await axios.get("/projectitems", {
          params: {
            projectId,
            kind,
            $limit: 500,
            "$sort[createdAt]": -1,
          },
          ...auth(),
        })
      );
    } catch (e) {
      console.error("ProjectWorkspaceService.list", e);
      return [];
    }
  },

  create: async (data: ProjectItem): Promise<ProjectItem | null> => {
    const res = await axios.post("/projectitems", data, auth());
    return ok(res) ? res.data : null;
  },

  update: async (
    id: string,
    data: Partial<ProjectItem>
  ): Promise<ProjectItem | null> => {
    const res = await axios.patch(`/projectitems/${id}`, data, auth());
    return ok(res) ? res.data : null;
  },

  remove: async (id: string): Promise<boolean> => {
    const res = await axios.delete(`/projectitems/${id}`, auth());
    return ok(res);
  },

  // Email a project's quote PDF to the client. Returns { sent, to } on success
  // or { sent:false, error } — the backend reports SMTP / missing-email issues.
  sendQuote: async (
    projectId: string,
    file?: File | null,
    opts?: {
      imageUrls?: string[];
      videoUrls?: string[];
      // Email-composer fields: custom subject/message, Cc, extra attachments.
      subject?: string;
      message?: string;
      cc?: string;
      attachments?: File[];
    }
  ): Promise<{
    sent?: boolean;
    to?: string;
    linkedVideos?: string[];
    attachedExtras?: number;
    skippedExtras?: string[];
    whatsapp?: {
      sent?: boolean;
      skipped?: boolean;
      reason?: string;
      to?: string;
      error?: string;
    };
    error?: string;
  }> => {
    try {
      const fd = new FormData();
      // The BOQ PDF is optional now — the client reviews the BOQ in-app.
      if (file) fd.append("file", file);
      fd.append("projectId", projectId);
      // Attach the selected render images/videos alongside the quote PDF.
      if (opts?.imageUrls)
        fd.append("imageUrls", JSON.stringify(opts.imageUrls));
      if (opts?.videoUrls)
        fd.append("videoUrls", JSON.stringify(opts.videoUrls));
      if (opts?.subject) fd.append("subject", opts.subject);
      if (opts?.message) fd.append("message", opts.message);
      if (opts?.cc) fd.append("cc", opts.cc);
      (opts?.attachments || []).forEach((f) => fd.append("attachments", f));
      const res = await axios.post("/send-quote", fd, {
        headers: { Authorization: `${AuthService.getAccessToken()}` },
      });
      return res?.data || { sent: false, error: "No response" };
    } catch (e: any) {
      return {
        sent: false,
        error: e?.response?.data?.message || e?.message || "Send failed",
      };
    }
  },

  // Architect "Send to admin": email all admins that a quote is pending
  // approval, WITH the BOQ PDF + the selected render images/videos attached.
  // Large videos are linked instead of attached (the backend decides) — the
  // response reports which were linked. Returns { sent, ... } or { sent:false, error }.
  submitForApproval: async (args: {
    projectId: string;
    pdf?: Blob | null;
    imageUrls: string[];
    videoUrls: string[];
    submittedBy?: string;
    // Email-composer fields: custom subject/message, Cc, and extra attachments
    // (2D diagram, docs…) the sender added.
    subject?: string;
    message?: string;
    cc?: string;
    attachments?: File[];
  }): Promise<{
    sent?: boolean;
    to?: string;
    attachedImages?: number;
    attachedVideos?: number;
    attachedExtras?: number;
    skippedExtras?: string[];
    linkedVideos?: string[];
    error?: string;
  }> => {
    try {
      const fd = new FormData();
      fd.append("projectId", args.projectId);
      if (args.pdf) fd.append("file", args.pdf, "BOQ.pdf");
      fd.append("imageUrls", JSON.stringify(args.imageUrls || []));
      fd.append("videoUrls", JSON.stringify(args.videoUrls || []));
      if (args.submittedBy) fd.append("submittedBy", args.submittedBy);
      if (args.subject) fd.append("subject", args.subject);
      if (args.message) fd.append("message", args.message);
      if (args.cc) fd.append("cc", args.cc);
      (args.attachments || []).forEach((f) => fd.append("attachments", f));
      const res = await axios.post("/submit-for-approval", fd, {
        headers: { Authorization: `${AuthService.getAccessToken()}` },
      });
      return res?.data || { sent: false, error: "No response" };
    } catch (e: any) {
      return {
        sent: false,
        error: e?.response?.data?.message || e?.message || "Send failed",
      };
    }
  },

  // Send a custom email to the client for a tracker step, with an optional file
  // attachment. Returns { sent, to } or { sent:false, error }.
  sendStepMail: async (args: {
    projectId: string;
    stage?: string;
    subject: string;
    message: string;
    cc?: string;
    file?: File | null;
  }): Promise<{
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
  }> => {
    try {
      const fd = new FormData();
      fd.append("projectId", args.projectId);
      if (args.stage) fd.append("stage", args.stage);
      fd.append("subject", args.subject);
      fd.append("message", args.message);
      if (args.cc) fd.append("cc", args.cc);
      if (args.file) fd.append("file", args.file);
      const res = await axios.post("/send-tracker-mail", fd, {
        headers: { Authorization: `${AuthService.getAccessToken()}` },
      });
      return res?.data || { sent: false, error: "No response" };
    } catch (e: any) {
      return {
        sent: false,
        error: e?.response?.data?.message || e?.message || "Send failed",
      };
    }
  },

  // Upload a file, returns { fileUrl, mimeType, size, originalName }.
  uploadFile: async (
    projectId: string,
    file: File
  ): Promise<{
    fileUrl: string;
    mimeType: string;
    size: number;
    originalName: string;
  } | null> => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectId", projectId);
      // Do NOT set Content-Type manually — the browser must add the multipart
      // boundary, or the server can't parse the file. Only send the auth header.
      const res = await axios.post("/project-file-upload", fd, {
        headers: { Authorization: `${AuthService.getAccessToken()}` },
      });
      return ok(res) ? res.data : null;
    } catch (e) {
      console.error("ProjectWorkspaceService.uploadFile", e);
      return null;
    }
  },
};
