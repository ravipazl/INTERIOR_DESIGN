import React, { useEffect, useState } from "react";
import { Button, Spinner } from "react-bootstrap";
import { getBoqForProject } from "../../services/boqService";
import { getInstallationRate } from "../../services/ratesService";
import { listItems, fileUrl } from "../../services/projectWorkspaceService";
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
  const transportCost = Number((0.0015 * totalPrice).toFixed(2));
  const packagingCost = Number((0.0015 * totalPrice).toFixed(2));
  const gst = Number((0.18 * totalPrice).toFixed(2));
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
        <div className="gsw-watermark">P</div>
        <div className="gsw-content">
          <div className="gsw-head">
            <div className="gsw-brand">
              <div className="gsw-brandname">PAZL</div>
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
              <div className="gsw-who">PAZL</div>
              <p>Regd. office: 17/12 #3B, Ganapathy Street, Chennai 600014</p>
              <p>Contact: +91 94440 94422 · Email: gafoo.ak@pazl.in</p>
              <p>R. Karthik (CEO) · +91 98405 44441 · karthik@nichedesginloft.com</p>
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
                <span className="gsw-k">GST 18%</span>
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
                <li><b>10%</b> — upon order &amp; design confirmation</li>
                <li><b>40%</b> — before commencement of work</li>
                <li><b>40%</b> — upon delivery of products</li>
                <li><b>10%</b> — after completion of work</li>
              </ol>
            </div>
            <div>
              <h4>Note</h4>
              <ol>
                <li>
                  Dimensions and estimation based on drawing provided by client,
                  actual measurements may vary on site.
                </li>
                <li>Items not mentioned in estimate will be charged additionally.</li>
                <li>All civil works not mentioned will be additional.</li>
                <li>
                  Estimate is valid for a time period of 30 days from date
                  mentioned above.
                </li>
                <li>
                  Light fittings will be based on final design, not included in
                  this estimate, cost will be actual.
                </li>
              </ol>
            </div>
            <div className="gsw-bank">
              <h4>Bank details</h4>
              <p><span className="gsw-bk">Bank name</span> State Bank of India</p>
              <p><span className="gsw-bk">Account name</span> NDL Interiors Private Ltd</p>
              <p><span className="gsw-bk">Account number</span> 36342320833</p>
              <p><span className="gsw-bk">IFSC code</span> SBIN0000962</p>
              <p><span className="gsw-bk">Branch</span> Gopalapuram</p>
            </div>
          </div>

          <div className="gsw-sign">
            <p>For Pazl</p>
            <p>Authorized seal or stamp</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BoqView;
