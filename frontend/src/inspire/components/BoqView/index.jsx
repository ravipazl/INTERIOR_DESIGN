import React, { useEffect, useState } from "react";
import { Button, Spinner } from "react-bootstrap";
import { getBoqForProject } from "../../services/boqService";
import { getInstallationRate } from "../../services/ratesService";
import { listItems, fileUrl } from "../../services/projectWorkspaceService";
import { useInvoiceProfile, pctLabel } from "@pazl/services/InvoiceProfileService";
import { useBranding } from "@pazl/services/BrandingService";
import "../BoqScreen/index.css";

/**
 * BoqView — the client's Bill of Quantity rendered inline as HTML, using the
 * same "gsw" Swiss skin + layout as the design app's Production-tab BOQ. Used
 * both as a Project Workspace section and inside the BoqScreen modal.
 */

const money = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const cap = (s) =>
  typeof s === "string" && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const nameOf = (it) => it?.model?.model?.name || it?.model?.name || "Item";
const priceOf = (it) => Number(it?.model?.price) || 0;
const roomOf = (it) => cap(it?.model?.roomName || "") || "Room";
const areaOf = (it) =>
  (Array.isArray(it?.parts) ? it.parts : []).reduce(
    (a, p) => a + (Number(p?.area) || 0),
    0
  );
const isInstallExcluded = (it) =>
  !!(it?.installationExcluded || it?.model?.installationExcluded);

function BoqView({ projectId, project, quoteNumber, prefetched }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [installRate, setInstallRate] = useState(0);
  const [pdfUrl, setPdfUrl] = useState("");
  // Settings → Tax / Invoice. A sent quote (public page) brings its own copy,
  // so it keeps the rates and details it was sent with.
  const invoice = useInvoiceProfile(prefetched?.invoice);
  const brand = useBranding();

  useEffect(() => {
    // Public quote page (no login) passes the BOQ already fetched from the
    // token endpoint — render it directly instead of calling the authed services.
    if (prefetched) {
      setItems(Array.isArray(prefetched.items) ? prefetched.items : []);
      setInstallRate(Number(prefetched.installRate) || 0);
      setPdfUrl(prefetched.pdfUrl || "");
      setError("");
      setLoading(false);
      return;
    }
    if (!projectId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      const [{ items: boqItems, error: err }, rate] = await Promise.all([
        getBoqForProject(projectId),
        getInstallationRate().catch(() => 0),
      ]);
      let url = "";
      try {
        const docs = await listItems(projectId, "document");
        const quote = (docs || [])
          .filter((d) => d?.type === "Quote" && d?.fileUrl)
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
        if (quote?.fileUrl) url = fileUrl(quote.fileUrl);
      } catch (_) {
        /* PDF optional */
      }
      if (cancelled) return;
      setItems(Array.isArray(boqItems) ? boqItems : []);
      setError(err || "");
      setInstallRate(Number(rate) || 0);
      setPdfUrl(url);
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, prefetched]);

  const groups = [];
  items.forEach((it) => {
    const room = roomOf(it);
    let g = groups.find((x) => x.room === room);
    if (!g) {
      g = { room, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  });

  const totalPrice = items.reduce((s, it) => s + priceOf(it), 0);
  const includedArea = Number(
    items
      .reduce((a, it) => a + (isInstallExcluded(it) ? 0 : areaOf(it)), 0)
      .toFixed(2)
  );
  const installationCost = Number((includedArea * installRate).toFixed(2));
  const transportCost = Number(((invoice.transportPct / 100) * totalPrice).toFixed(2));
  const packagingCost = Number(((invoice.packingPct / 100) * totalPrice).toFixed(2));
  const gst = Number(((invoice.gstRate / 100) * totalPrice).toFixed(2));
  const grossTotal = Number(
    (totalPrice + transportCost + packagingCost + installationCost + gst).toFixed(2)
  );
  const today = new Date().toLocaleDateString("en-GB");

  if (loading) {
    return (
      <div className="d-flex align-items-center justify-content-center py-5">
        <Spinner animation="border" size="sm" className="me-2" /> Loading your
        BOQ…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-4" style={{ color: "#b91c1c" }}>
        {error}
      </div>
    );
  }

  return (
    <div>
      {pdfUrl ? (
        <div className="d-flex justify-content-end mb-2">
          <Button
            variant="outline-primary"
            size="sm"
            onClick={() => window.open(pdfUrl, "_blank", "noopener")}
          >
            Download PDF
          </Button>
        </div>
      ) : null}

      <div className="gsw-paper">
        <div className="gsw-watermark">
          {(invoice.companyName || "P").trim().charAt(0).toUpperCase()}
        </div>
        <div className="gsw-content">
          <div className="gsw-head">
            <div className="gsw-brand">
              {/* The invoice logo (Settings → Tax / Invoice), else the app logo
                  (Settings → Branding), else PAZL — as in the 3D app's BOQ. */}
              <img
                className="gsw-logo"
                src={invoice.logo || brand.logo || require("../../../react-app/images/pazl.png")}
                alt={invoice.companyName}
              />
              <div className="gsw-brandname">{invoice.companyName}</div>
            </div>
            <div className="gsw-meta">
              <div className="gsw-doclabel">Bill of Quantity</div>
              <div className="gsw-r">
                <span className="gsw-k">Quote No.</span>
                <span className="gsw-v">{quoteNumber || "—"}</span>
              </div>
              <div className="gsw-r">
                <span className="gsw-k">Rev No.</span>
                <span className="gsw-v">{project?.revisedBoqNumber || "—"}</span>
              </div>
              <div className="gsw-r">
                <span className="gsw-k">Date</span>
                <span className="gsw-v">{today}</span>
              </div>
            </div>
          </div>

          <div className="gsw-headline">
            Bill of Quantity<span className="gsw-accdot"></span>
          </div>
          <div className="gsw-thickrule"></div>

          <div className="gsw-parties">
            <div className="gsw-party">
              <div className="gsw-lbl">From</div>
              <div className="gsw-who">{invoice.companyName}</div>
              {invoice.address
                .split("\n")
                .filter((l) => l.trim())
                .map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              {invoice.phone || invoice.email ? (
                <p>
                  {[
                    invoice.phone ? `Contact: ${invoice.phone}` : "",
                    invoice.email ? `Email: ${invoice.email}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
              {invoice.contactLine ? <p>{invoice.contactLine}</p> : null}
              {invoice.gstin || invoice.pan ? (
                <p>
                  {[
                    invoice.gstin ? `GSTIN: ${invoice.gstin}` : "",
                    invoice.pan ? `PAN: ${invoice.pan}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="gsw-party">
              <div className="gsw-lbl">Prepared for</div>
              <div className="gsw-who">{project?.clientName || "—"}</div>
              <p>Address: {project?.address || "—"}</p>
              <p>
                Phone: {project?.clientPhoneNumber || "—"} · Email:{" "}
                {project?.clientEmail || "—"}
              </p>
              <p>Client GST: {project?.clientGSTNumber || "—"}</p>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="text-center py-4" style={{ color: "#66666e" }}>
              No priced items in this design yet.
            </div>
          ) : (
            <div className="gsw-items">
              {groups.map((group, gi) => {
                const roomTotal = group.items.reduce(
                  (t, it) => t + priceOf(it),
                  0
                );
                return (
                  <React.Fragment key={group.room + gi}>
                    <div className="gsw-roomhead">
                      <span className="gsw-roomno">
                        {String(gi + 1).padStart(2, "0")}
                      </span>
                      <span className="gsw-roomname">{group.room}</span>
                      <span className="gsw-roomrule" />
                      <span className="gsw-roomtotal">{money(roomTotal)}</span>
                    </div>
                    {group.items.map((it, ii) => (
                      <div className="gsw-item-head" key={it?.model?._id || ii}>
                        <div className="gsw-item-main">
                          <div className="gsw-item-name">{nameOf(it)}</div>
                        </div>
                        <div className="gsw-item-nums">
                          <div>
                            <span className="gsw-nl">Unit</span>
                            <span className="gsw-nv">{money(priceOf(it))}</span>
                          </div>
                          <div>
                            <span className="gsw-nl">Qty</span>
                            <span className="gsw-nv">1</span>
                          </div>
                          <div>
                            <span className="gsw-nl">Total</span>
                            <span className="gsw-nv strong">
                              {money(priceOf(it))}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          <div className="gsw-totals">
            <div className="gsw-breakdown">
              <div className="gsw-tl">
                <span className="gsw-k">Total amount</span>
                <span className="gsw-v">{money(totalPrice)}</span>
              </div>
              <div className="gsw-tl">
                <span className="gsw-k">Transport</span>
                <span className="gsw-v">{money(transportCost)}</span>
              </div>
              <div className="gsw-tl">
                <span className="gsw-k">Packing</span>
                <span className="gsw-v">{money(packagingCost)}</span>
              </div>
              <div className="gsw-tl">
                <span className="gsw-k">
                  Installation{" "}
                  <span className="gsw-s">
                    {includedArea} ft² @ ₹{installRate}/ft²
                  </span>
                </span>
                <span className="gsw-v">{money(installationCost)}</span>
              </div>
              <div className="gsw-tl">
                <span className="gsw-k">GST {pctLabel(invoice.gstRate)}%</span>
                <span className="gsw-v">{money(gst)}</span>
              </div>
              <div className="gsw-tl gross">
                <span className="gsw-k">Gross total</span>
                <span className="gsw-v">{money(grossTotal)}</span>
              </div>
            </div>
            <div className="gsw-net">
              <div className="gsw-k">Net total</div>
              <div className="gsw-v">{money(grossTotal)}</div>
            </div>
          </div>

          <div className="gsw-foot">
            <div>
              <h4>Payment schedule</h4>
              <ol>
                {invoice.paymentSchedule.map((r, i) => (
                  <li key={i}>
                    <b>{pctLabel(r.percent)}%</b> — {r.text}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h4>Note</h4>
              <ol>
                {invoice.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ol>
            </div>
            <div className="gsw-bank">
              <h4>Bank details</h4>
              {[
                ["Bank name", invoice.bankName],
                ["Account name", invoice.accountName],
                ["Account number", invoice.accountNumber],
                ["IFSC code", invoice.ifsc],
                ["Branch", invoice.branch],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <p key={k}>
                    <span className="gsw-bk">{k}</span> {v}
                  </p>
                ))}
            </div>
          </div>

          <div className="gsw-sign">
            <p>{invoice.forText}</p>
            <p>{invoice.signText}</p>
          </div>
          {invoice.footerTerms ? (
            <div className="gsw-terms">
              {invoice.footerTerms.split("\n").map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default BoqView;
