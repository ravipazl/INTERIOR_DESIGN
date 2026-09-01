import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  useMaterialReactTable,
  createMRTColumnHelper,
} from "material-react-table";
import generatePDF, { Margin, Resolution, usePDF } from "react-to-pdf";
import { FloorPlanService } from "@pazl/services/floorPlanService";
import BlueprintInterface from "@pazl/blueprint-interface";
import { capitalizeText } from "@pazl/utils/genericFunctions";
import { FurnishedModelComponent } from "@pazl/entities/FurnishedModelComponent";
import "./index.css";
import { ProjectsService } from "@pazl/services/projectsService";
import { FurnishedModelsService } from "@pazl/services/furnishedModelsService";
import { RatesService } from "@pazl/services/RatesService";
import { ProjectWorkspaceService } from "@pazl/services/ProjectWorkspaceService";
import {
  Autocomplete,
  TextField,
  Box,
  Collapse,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";

interface TableRowType {
  total_price: string;
  quantity: string;
  unit_price: string;
  item_description: string;
  item_name: string | undefined;
  thumbnail: string | undefined;
  room: string;
  flag?: string;
  parts?: any[];
  otherCosts?: { label: string; amount: number }[];
  hardwareItems?: {
    name: string;
    unitPrice: number;
    qty: number;
    fromMaster?: boolean;
  }[];
  furnishedModelId?: string;
  area?: number;
  installationExcluded?: boolean;
  items?: {
    item_name: string;
    item_description: string;
    thumbnail: string;
    unit_price: string;
    quantity: string;
    total_price: string;
  }[];
}

interface propsType {
  projectId: string | undefined;
  activeTab?: string;
  // Hands a "build the BOQ as a PDF Blob" function up to the parent, so the
  // Renders & videos "Send to admin" can attach the BOQ to the approval email.
  registerPdfGetter?: (fn: () => Promise<Blob | null>) => void;
}

interface BoqTableProps {
  projectId: string | undefined;
  activeTab?: string;
  registerPdfGetter?: (fn: () => Promise<Blob | null>) => void;
}

interface GroupedDataRow {
  room: string;
  items: TableRowType[];
}

const clientInfoColumns = [
  { id: 1, columnName: "Date" },
  { id: 2, columnName: "Quote Number" },
  { id: 3, columnName: "Rev Quote Number" },
  { id: 4, columnName: "Client Name" },
  { id: 5, columnName: "Client Phone Number" },
  { id: 6, columnName: "Client Email Id" },
  { id: 7, columnName: "Address" },
  { id: 8, columnName: "Client GST Number" },
];

// Transport + Packing together = 0.3% of the items subtotal, split evenly
// (0.15% each). Adjust this one number to change the rate.
const TRANSPORT_PACKING_PCT = 0.003;

const rupee = (n: number) =>
  n ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—";

// Money with exactly 2 decimals (avoids floating-point tails like
// ₹17760.489999999998). e.g. money(17760.489999) -> "₹17,760.49".
const money = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Per-part cost breakdown shown under each cabinet: area × (board + interior +
// exterior). Unexposed parts show "skip" for exterior (Option A). Hardware
// parts (handles/legs) show only their flat line price.
const PartsBreakdown: React.FC<{ parts: any[]; extraHardware?: number }> = ({
  parts,
  extraHardware = 0,
}) => {
  if (!parts?.length) return null;
  const boardTotal = parts.reduce((s, p) => s + (p.boardCost || 0), 0);
  const finishTotal = parts.reduce(
    (s, p) => s + (p.interiorCost || 0) + (p.exteriorCost || 0),
    0
  );
  // Hardware = part-level hardware (handles/legs) PLUS the manually-added
  // hardware lines below, so this summary matches the "Hardware ₹…" total in the
  // editor instead of showing "—" while hardware exists.
  const hardwareTotal =
    parts.reduce((s, p) => s + (p.isHardware ? p.lineTotal || 0 : 0), 0) +
    (Number(extraHardware) || 0);
  const th: React.CSSProperties = {
    padding: "6px 8px",
    textAlign: "left",
    textTransform: "uppercase",
    letterSpacing: ".6px",
    fontSize: 10,
    color: "#9a9aa2",
  };
  const td: React.CSSProperties = {
    padding: "6px 8px",
    borderTop: "1px solid #e2e2e0",
    color: "#66666e",
  };
  const r: React.CSSProperties = {
    ...td,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  };
  // Total on top, the per-sqft rate (rate × area = total) as a muted sub-line.
  const rateSub: React.CSSProperties = { fontSize: 9.5, color: "#9a9aa2" };
  const costCell = (cost: number, rate: number) => (
    <>
      {rupee(cost)}
      {rate > 0 ? <div style={rateSub}>@ {rupee(rate)}/ft²</div> : null}
    </>
  );
  return (
    <div style={{ margin: "10px 0 8px", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, borderTop: "1px solid #e2e2e0" }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th style={th}>Part</th>
            <th style={{ ...th, textAlign: "right" }}>Area ft²</th>
            <th style={{ ...th, textAlign: "right" }}>Board</th>
            <th style={{ ...th, textAlign: "right" }}>Interior</th>
            <th style={{ ...th, textAlign: "right" }}>Exterior</th>
            <th style={{ ...th, textAlign: "right" }}>Line</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p, i) => (
            <tr key={i}>
              <td style={{ ...td, color: "#17171b", fontWeight: 600 }}>
                {capitalizeText(p.name)}
                {!p.isHardware && !p.exposed ? (
                  <span style={{ fontSize: 10, color: "#993c1d", marginLeft: 4 }}>· unexposed</span>
                ) : null}
              </td>
              <td style={r}>{p.isHardware ? "—" : p.area}</td>
              <td style={r}>
                {p.isHardware ? "—" : costCell(p.boardCost, p.boardRate)}
              </td>
              <td style={r}>
                {p.isHardware ? "—" : costCell(p.interiorCost, p.interiorRate)}
              </td>
              <td style={r}>
                {p.isHardware ? "—" : !p.exposed ? (
                  <span style={{ color: "#993c1d" }}>skip</span>
                ) : (
                  costCell(p.exteriorCost, p.exteriorRate)
                )}
              </td>
              <td style={{ ...r, fontWeight: 500 }}>{rupee(p.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          marginTop: 8,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#f7f7f9",
            border: "1px solid #ececef",
            borderRadius: 999,
            padding: "5px 14px",
            fontSize: 11,
            color: "#6b7280",
          }}
        >
          {[
            ["Board", boardTotal],
            ["Finish", finishTotal],
            ["Hardware", hardwareTotal],
          ].map(([label, val], i) => (
            <React.Fragment key={label as string}>
              {i > 0 ? (
                <span style={{ color: "#d6d6db" }}>|</span>
              ) : null}
              <span>
                {label}{" "}
                <b style={{ color: "#111827", fontWeight: 600 }}>
                  {rupee(val as number)}
                </b>
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

// Per-object manual "other costs" (hardware, handles, edge-banding, …). Rows are
// label + amount; edits persist to the object and the delta is reported up so the
// grand total stays in sync without a full BOQ regeneration.
const OtherCostsEditor: React.FC<{
  furnishedModelId?: string;
  initialRows: { label: string; amount: number }[];
  onChange: (furnishedModelId: string, delta: number) => void;
}> = ({ furnishedModelId, initialRows, onChange }) => {
  const sum = (rs: { amount: any }[]) =>
    (rs || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const [rows, setRows] = useState<{ label: string; amount: any }[]>(
    initialRows?.length ? initialRows : []
  );
  // Last-saved subtotal, so we can report just the delta and skip no-op blurs.
  const committed = useRef<number>(sum(initialRows));

  const persist = async (next: { label: string; amount: any }[]) => {
    if (!furnishedModelId) return;
    const clean = next
      .filter((r) => (r.label || "").trim() !== "" || Number(r.amount))
      .map((r) => ({
        label: (r.label || "").trim(),
        amount: Number(r.amount) || 0,
      }));
    const newSub = sum(clean);
    if (newSub === committed.current) return; // nothing changed → no work
    await FurnishedModelsService.updateOtherCosts(furnishedModelId, clean);
    // Update totals in place (no BOQ regeneration / page reload).
    onChange(furnishedModelId, newSub - committed.current);
    committed.current = newSub;
  };

  const subtotal = sum(rows);
  const inputStyle: React.CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: 12,
  };

  return (
    <div style={{ margin: "2px 0 14px", fontSize: 12 }}>
      <div style={{ color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>
        Other Costs
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}
        >
          <input
            style={{ ...inputStyle, flex: "1 1 auto" }}
            placeholder="Label (e.g. Hardware)"
            value={row.label}
            onChange={(e) =>
              setRows(rows.map((r, idx) => (idx === i ? { ...r, label: e.target.value } : r)))
            }
            onBlur={() => persist(rows)}
          />
          <span style={{ color: "#6b7280" }}>₹</span>
          <input
            style={{ ...inputStyle, width: 90, textAlign: "right" }}
            type="number"
            placeholder="0"
            value={row.amount}
            onChange={(e) =>
              setRows(rows.map((r, idx) => (idx === i ? { ...r, amount: e.target.value } : r)))
            }
            onBlur={() => persist(rows)}
          />
          <button
            type="button"
            title="Remove"
            onClick={() => {
              const next = rows.filter((_, idx) => idx !== i);
              setRows(next);
              persist(next);
            }}
            style={{ color: "#993c1d", border: "none", background: "none", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <button
          type="button"
          onClick={() => setRows([...rows, { label: "", amount: "" }])}
          style={{
            color: "#059669",
            border: "1px dashed #059669",
            borderRadius: 4,
            padding: "2px 10px",
            background: "none",
            cursor: "pointer",
          }}
        >
          + Add cost
        </button>
        {subtotal ? (
          <span style={{ color: "#6b7280" }}>
            Other <b style={{ color: "#111827" }}>{rupee(subtotal)}</b>
          </span>
        ) : null}
      </div>
    </div>
  );
};

// Per-object hardware lines. Pick from the Hardware master (name + unit price
// fixed from master) or "Other" (type a one-off name + unit price — NOT saved to
// the master). qty × unitPrice = line total; edits persist to the object and the
// delta is reported up so totals stay in sync without a BOQ regeneration.
const HardwareEditor: React.FC<{
  furnishedModelId?: string;
  initialRows: {
    name: string;
    unitPrice: number;
    qty: number;
    fromMaster?: boolean;
  }[];
  master: { _id: string; name: string; price: number }[];
  onChange: (furnishedModelId: string, delta: number) => void;
  onSubtotal?: (furnishedModelId: string, subtotal: number) => void;
}> = ({ furnishedModelId, initialRows, master, onChange, onSubtotal }) => {
  const lineTotal = (r: any) =>
    (Number(r.qty) || 0) * (Number(r.unitPrice) || 0);
  const sum = (rs: any[]) => (rs || []).reduce((s, r) => s + lineTotal(r), 0);
  const [rows, setRows] = useState<any[]>(
    (initialRows?.length ? initialRows : []).map((r) => ({
      ...r,
      // Re-derive the "custom (Other…)" flag on load — it isn't persisted. A row
      // that has a NAME but is NOT from the hardware master is a custom entry, so
      // mark it __other so its name shows again (instead of an empty search box).
      __other: !r.fromMaster && !!String(r.name || "").trim(),
    }))
  );
  const committed = useRef<number>(sum(initialRows));

  const persist = async (next: any[]) => {
    if (!furnishedModelId) return;
    const clean = next
      .filter((r) => (r.name || "").trim() !== "")
      .map((r) => ({
        name: (r.name || "").trim(),
        unitPrice: Number(r.unitPrice) || 0,
        qty: Number(r.qty) || 0,
        fromMaster: !!r.fromMaster,
      }));
    const newSub = sum(clean);
    if (newSub === committed.current) return;
    await FurnishedModelsService.updateHardwareItems(furnishedModelId, clean);
    onChange(furnishedModelId, newSub - committed.current);
    committed.current = newSub;
    // Report the live subtotal so the top summary's "Hardware ₹…" stays in sync.
    onSubtotal?.(furnishedModelId, newSub);
  };

  const setRow = (i: number, patch: any) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const inputStyle: React.CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: 12,
  };
  // Searchable options: master hardware + an "Other…" sentinel.
  const OTHER_OPT: any = {
    _id: "__other__",
    name: "Other…",
    price: 0,
    __isOther: true,
  };
  const hwOptions = [...(master || []), OTHER_OPT];

  return (
    <div style={{ margin: "2px 0 14px", fontSize: 12 }}>
      <div style={{ color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>
        Hardware
      </div>
      {rows.map((row, i) => {
        const acValue = row.fromMaster
          ? master.find((m) => m.name === row.name) ?? null
          : row.__other
          ? OTHER_OPT
          : null;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <Autocomplete
              size="small"
              disablePortal
              options={hwOptions}
              value={acValue}
              getOptionLabel={(o: any) =>
                o?.__isOther ? "Other…" : `${o?.name} (₹${o?.price})`
              }
              isOptionEqualToValue={(o: any, v: any) => o._id === v._id}
              onChange={(_e, val: any) => {
                let next;
                if (val && val.__isOther) {
                  next = rows.map((r, idx) =>
                    idx === i
                      ? { ...r, __other: true, fromMaster: false, name: "", unitPrice: 0 }
                      : r
                  );
                } else if (val) {
                  next = rows.map((r, idx) =>
                    idx === i
                      ? {
                          ...r,
                          __other: false,
                          fromMaster: true,
                          name: val.name,
                          unitPrice: val.price,
                        }
                      : r
                  );
                } else {
                  next = rows.map((r, idx) =>
                    idx === i
                      ? { ...r, __other: false, fromMaster: false, name: "", unitPrice: 0 }
                      : r
                  );
                }
                setRows(next);
                persist(next);
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  placeholder="Search hardware…"
                />
              )}
              sx={{ flex: "1 1 auto", minWidth: 160 }}
            />
            {row.__other ? (
              <input
                style={{ ...inputStyle, width: 120 }}
                placeholder="Name"
                value={row.name}
                onChange={(e) => setRow(i, { name: e.target.value })}
                onBlur={() => persist(rows)}
              />
            ) : null}
            <span style={{ color: "#6b7280" }}>₹</span>
            {row.__other ? (
              <input
                style={{ ...inputStyle, width: 70, textAlign: "right" }}
                type="number"
                placeholder="0"
                value={row.unitPrice || ""}
                onChange={(e) =>
                  setRow(i, { unitPrice: Number(e.target.value) })
                }
                onBlur={() => persist(rows)}
              />
            ) : (
              <span style={{ width: 70, textAlign: "right" }}>
                {row.unitPrice}
              </span>
            )}
            <span style={{ color: "#6b7280" }}>×</span>
            <input
              style={{ ...inputStyle, width: 50, textAlign: "right" }}
              type="number"
              min={0}
              value={row.qty ?? ""}
              placeholder="0"
              onChange={(e) => setRow(i, { qty: Number(e.target.value) })}
              onBlur={() => persist(rows)}
            />
            <span style={{ width: 70, textAlign: "right", color: "#111827" }}>
              {rupee(lineTotal(row))}
            </span>
            <button
              type="button"
              title="Remove"
              onClick={() => {
                const next = rows.filter((_, idx) => idx !== i);
                setRows(next);
                persist(next);
              }}
              style={{
                color: "#993c1d",
                border: "none",
                background: "none",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={() =>
            setRows([
              ...rows,
              { name: "", unitPrice: 0, qty: 1, fromMaster: false, __other: false },
            ])
          }
          style={{
            color: "#059669",
            border: "1px dashed #059669",
            borderRadius: 4,
            padding: "2px 10px",
            background: "none",
            cursor: "pointer",
          }}
        >
          + Add hardware
        </button>
        {/* Bottom "Hardware ₹…" subtotal removed — it now shows in the top
            Board/Finish/Hardware summary pill, so it was redundant here. */}
      </div>
    </div>
  );
};

const BoqTable: React.FC<BoqTableProps> = ({
  projectId,
  activeTab,
  registerPdfGetter,
}: propsType) => {
  const prevTab = useRef<string | undefined>(undefined);
  const [data, setData] = useState<TableRowType[]>([]);
  const [groupedData, setGroupedData] = useState<GroupedDataRow[]>([]);
  const [clientInfoRows, setClientInfoRows] = useState<any[]>([]);
  // Hardware master list (for the per-object hardware dropdown).
  const [hardwareMaster, setHardwareMaster] = useState<any[]>([]);
  useEffect(() => {
    RatesService.listHardware().then((hw: any) => setHardwareMaster(hw || []));
  }, []);
  const [totalPrice, setTotalPrice] = useState(0);
  const [grossTotalPrice, setGrossTotalPrice] = useState(0);
  // Installation = global ₹/sqft rate × the area of objects that are INCLUDED
  // (each object has a per-object include/exclude toggle — e.g. a lamp = off).
  const [installationRate, setInstallationRate] = useState(0);
  useEffect(() => {
    RatesService.getInstallationRate().then((r: number) =>
      setInstallationRate(r || 0)
    );
  }, []);
  const includedArea = Number(
    (groupedData || [])
      .reduce(
        (s, g) =>
          s +
          (g.items || []).reduce(
            (a, it) => a + (it.installationExcluded ? 0 : Number(it.area) || 0),
            0
          ),
        0
      )
      .toFixed(2)
  );
  const installationCost = Number((includedArea * installationRate).toFixed(2));

  // Transport & Packing as a percentage of the items subtotal (0.15% each →
  // 0.3% combined), recomputed whenever the subtotal changes.
  const transportCost = Number(
    ((TRANSPORT_PACKING_PCT / 2) * totalPrice).toFixed(2)
  );
  const packagingCost = Number(
    ((TRANSPORT_PACKING_PCT / 2) * totalPrice).toFixed(2)
  );

  // Single source of truth for the Gross/Net total. GST is charged on the items
  // subtotal only; Transport / Packing / Installation are added flat afterwards.
  useEffect(() => {
    const gross =
      totalPrice +
      transportCost +
      packagingCost +
      installationCost +
      0.18 * totalPrice;
    setGrossTotalPrice(Number(gross.toFixed(2)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPrice, installationCost]);

  // Apply an Other-Cost change in place (no BOQ regeneration / page reload):
  // bump the object's line price and the room's group total; the Gross/Net
  // recompute via the effect above off the new totalPrice.
  // Live manual-hardware subtotal per object, so the top Board/Finish/Hardware
  // summary reflects hardware edits immediately (falls back to the saved
  // hardwareItems on first render).
  const [hardwareByModel, setHardwareByModel] = useState<
    Record<string, number>
  >({});
  const sumHardware = (rows: any[]) =>
    (rows || []).reduce(
      (s, r) => s + (Number(r?.qty) || 0) * (Number(r?.unitPrice) || 0),
      0
    );

  const applyOtherCostChange = (furnishedModelId: string, delta: number) => {
    if (!delta) return;
    setGroupedData((prev) =>
      prev.map((group) => ({
        ...group,
        items: group.items.map((it) => {
          if (it.furnishedModelId !== furnishedModelId) return it;
          const cur = parseFloat((it.total_price || "₹0").slice(1)) || 0;
          const np = Number((cur + delta).toFixed(2));
          return { ...it, total_price: `₹${np}`, unit_price: `₹${np}` };
        }),
      }))
    );
    setTotalPrice((prev) => Number((prev + delta).toFixed(2)));
  };

  // Toggle an object in/out of installation. Flips the flag in place (which
  // re-derives includedArea → installationCost → totals) and persists it.
  const toggleInstallation = (
    furnishedModelId?: string,
    currentExcluded?: boolean
  ) => {
    if (!furnishedModelId) return;
    const newExcluded = !currentExcluded;
    setGroupedData((prev) =>
      prev.map((group) => ({
        ...group,
        items: group.items.map((it) =>
          it.furnishedModelId === furnishedModelId
            ? { ...it, installationExcluded: newExcluded }
            : it
        ),
      }))
    );
    FurnishedModelsService.setInstallationExcluded(
      furnishedModelId,
      newExcluded
    );
  };

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [quoteNumber, setQuoteNumber] = useState("");
  const { toPDF, targetRef } = usePDF({
    filename: `pazl-boq-${Date.now()}.pdf`,
  });
  const [rowsTable, setRowsTable] = useState<{ room: any }[]>([]);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [expandedRooms, setExpandedRooms] = useState<string[]>([]);
  // When true, the BOQ renders the CLIENT format for the outgoing PDF: line items
  // still show, but the internal per-item breakdown (parts, hardware, other costs,
  // install toggle) is hidden so the PDF matches the clean quote the client sees —
  // not the elaborate editing view. Toggled only while getBoqPdfBlob rasterises.
  const [clientPdfMode, setClientPdfMode] = useState(false);

  const handleExpand = (roomName: string) => {
    setExpandedRoom((prevRoom) => (prevRoom === roomName ? null : roomName));
  };

  useEffect(() => {
    getTableData();
  }, [BlueprintInterface?.ProjectManagerService?.project]);

  useEffect(() => {
    fetchData();
  }, [projectId]);

  // Regenerate the BOQ each time the user switches INTO the Production tab, so
  // objects just added/removed in the 3D editor show up without a page refresh.
  // (The tab keeps this component mounted, so a mount-only fetch went stale.)
  useEffect(() => {
    if (
      activeTab === "production" &&
      prevTab.current &&
      prevTab.current !== "production"
    ) {
      fetchData();
    }
    prevTab.current = activeTab;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      let floorPlanId: string = "";

      if (projectId) {
        // Fetch floor plan ID using projectId
        const fetchedFloorPlanId = await FloorPlanService.getFloorPlanId(
          projectId
        );
        if (typeof fetchedFloorPlanId === "string") {
          floorPlanId = fetchedFloorPlanId;
        } else {
          console.error("Invalid floorPlanId received:", fetchedFloorPlanId);
          return;
        }
      } else if (BlueprintInterface?.ProjectManagerService?.floorPlan?._id) {
        // Use floor plan ID from BlueprintInterface
        floorPlanId = BlueprintInterface.ProjectManagerService.floorPlan._id;
      } else {
        console.error("No valid floorPlanId found.");
        return;
      }

      if (floorPlanId) {
        const response = await FloorPlanService.generateBOQ(floorPlanId);
        if (response?.length) {
          const formattedRows = await Promise.all(
            response.map(async (item: any) => {
              let backPanelDesc = "";
              let exteriorFinishDesc = "";
              let interiorFinishDesc = "";
              let panelsDesc = "";
              let shutterDesc = "";
              let legsDesc = "";
              let handlesDesc = "";
              let counterTopDesc = "";

              const backPanel: FurnishedModelComponent | undefined =
                item.components.find(
                  (comp: FurnishedModelComponent) =>
                    comp.name.toLowerCase().includes("back") &&
                    comp.name.toLowerCase().includes("panel")
                );
              if (backPanel) {
                backPanelDesc = `${backPanel.coreMaterialThickness}mm, ${
                  backPanel.coreMaterialBrand?.name ?? ""
                }`;
                exteriorFinishDesc = `${
                  backPanel.externalFinishFinishing?.category?.name ?? ""
                }`;
                interiorFinishDesc = `${
                  backPanel.internalFinishFinishing?.category?.name ?? ""
                }`;
              }

              const sidePanel: FurnishedModelComponent | undefined =
                item.components.find(
                  (comp: FurnishedModelComponent) =>
                    comp.name.toLowerCase().includes("side") &&
                    comp.name.toLowerCase().includes("panel")
                );
              if (sidePanel) {
                panelsDesc = `${sidePanel.coreMaterialThickness}mm, ${
                  sidePanel.coreMaterialBrand?.name ?? ""
                }`;
              }

              const shutter: FurnishedModelComponent | undefined =
                item.components.find((comp: FurnishedModelComponent) =>
                  comp.name.toLowerCase().includes("shutter")
                );
              if (shutter) {
                shutterDesc = `${shutter.coreMaterialThickness}mm, ${
                  shutter.coreMaterialBrand?.name ?? ""
                }`;
              }

              const legs: FurnishedModelComponent[] = item.components.filter(
                (comp: FurnishedModelComponent) =>
                  comp.name.toLowerCase().includes("leg")
              );
              legsDesc = `${legs.length} no${legs.length > 1 ? "s" : ""}`;

              const handles: FurnishedModelComponent[] = item.components.filter(
                (comp: FurnishedModelComponent) =>
                  comp.name.toLowerCase().includes("handle")
              );
              handlesDesc = `${handles.length} no${
                handles.length > 1 ? "s" : ""
              }`;

              const counterTop: FurnishedModelComponent | undefined =
                item.components.find(
                  (comp: FurnishedModelComponent) =>
                    comp.name.toLowerCase().includes("counter") &&
                    comp.name.toLowerCase().includes("top")
                );
              if (counterTop) {
                counterTopDesc = `${counterTop.coreMaterialThickness}mm, ${
                  counterTop.coreMaterialType?.type ?? ""
                }`;
              }

              // Just the item name + overall size. The empty "Back panel /
              // Exterior / Interior / Other panels / Shutter / Legs / Handles /
              // CounterTop" lines were noise — the per-mesh parts table below
              // carries the real breakdown.
              const itemDescription = `<span><strong>${
                item.model?.model?.name ?? item.model?.name ?? "Item"
              }:</strong> (${getDimensionString(item.model.dimensions)})</span>`;

              // Flag panels the BOQ couldn't price exactly: a hard ⚠ when a
              // panel had no rate at all, a soft note when it fell back to the
              // default board material (Option B).
              const noRate = item.boqFlags?.noRateCount ?? 0;
              const defaulted = item.boqFlags?.defaultedCount ?? 0;
              const flag = noRate
                ? `⚠ ${noRate} panel(s) have no rate`
                : defaulted
                ? `ⓘ default material on ${defaulted} panel(s)`
                : "";

              return {
                room: capitalizeText(item.model?.roomName ?? ""),
                item_name: capitalizeText(
                  item.model?.model?.name ?? item.model?.name ?? "Item"
                ),
                item_description: itemDescription,
                quantity: "1",
                unit_price: `₹${item.model?.price ?? 0}`,
                total_price: `₹${item.model?.price ?? 0}`,
                thumbnail: item.model?.model?.thumbnail ?? "",
                flag,
                parts: item.parts || [],
                otherCosts: item.otherCosts || [],
                hardwareItems: item.hardwareItems || [],
                furnishedModelId: item.model?._id,
                area: (item.parts || []).reduce(
                  (a: number, p: any) => a + (Number(p?.area) || 0),
                  0
                ),
                installationExcluded: !!item.installationExcluded,
              };
            })
          );

          const groupedByRoom = formattedRows.reduce(
            (acc: GroupedDataRow[], cur) => {
              const existingGroup = acc.find(
                (group) => group.room === cur.room
              );
              if (existingGroup) {
                existingGroup.items.push(cur);
              } else {
                acc.push({ room: cur.room, items: [cur] });
              }
              return acc;
            },
            []
          );

          setGroupedData(groupedByRoom);
          // Calculate total price, GST, and gross total price
          const totalPrice = response.reduce(
            (sum: number, item: any) => sum + (Number(item.model?.price) || 0),
            0
          );
          setRowsTable(formattedRows);
          setTotalPrice(totalPrice);
          // Installation (area × rate, per included object) is derived from
          // groupedData; Gross/Net recompute via the [totalPrice, installationCost]
          // effect.
        } else {
          console.error("No items found in response.");
        }
      } else {
        console.error("Floor plan ID is null.");
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getDimensionString = (dimension: number[]) => {
    if (!Array.isArray(dimension) || dimension.length < 2) return "";
    // Show mm to match the 3D editor and the rest of the app (was cm).
    const fmt = (v: number) => (`${v}`.includes(".") ? v.toFixed(2) : `${v}`);
    const h = `${fmt(dimension[0])}mm*`;
    const w = `${fmt(dimension[1])}mm`;
    return `${h}${w}`;
  };

  const getTableData = async () => {
    setIsLoading(true);
    const project = BlueprintInterface?.ProjectManagerService?.project?._id
      ? BlueprintInterface.ProjectManagerService.project
      : projectId
      ? await ProjectsService.getProjectById(projectId)
      : null;
    if (project) {
      setQuoteNumber(project.boqNumber ?? "");
      setClientInfoRows([
        {
          id: 101,
          value: new Date().toLocaleDateString("en-GB", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }),
        },
        { id: 102, value: project.boqNumber ?? "N/A" },
        { id: 103, value: project.revisedBoqNumber ?? "N/A" },
        { id: 104, value: project.clientName ?? "N/A" },
        { id: 105, value: project.clientPhoneNumber ?? "N/A" },
        { id: 106, value: project.clientEmail ?? "N/A" },
        { id: 107, value: project.address ?? "N/A" },
        { id: 108, value: project.clientGSTNumber ?? "N/A" },
      ]);
    }
    setIsLoading(false);
  };

  // The "Generate BOQ" button. `getTableData` only refreshes the client-info
  // header — the actual pricing lives in `fetchData` (which was previously only
  // triggered by switching into the Production tab). Run BOTH so the button
  // regenerates the priced line items AND the header.
  const handleGenerateBoq = async () => {
    await fetchData();
    await getTableData();
  };

  // Approval workflow. The architect submits the priced quote for review; the
  // admin approves it; only then does "Send Quote to Client" appear. Each step
  // is a status change on the project (mirrored to the AI backend, which fires
  // the email + bell notification).
  // "Design complete" (marking the project pending approval) is no longer a
  // button here — it's folded into the single "Send to admin" action in the
  // Renders & videos section, which submits the BOQ + selected renders together.

  // Build the BOQ as a PDF Blob (no download) so the Renders & videos
  // "Send to admin" can attach it to the approval email. Same render as the
  // PDF export, just compressed (smaller = friendlier email attachment).
  const getBoqPdfBlob = useCallback(async (): Promise<Blob | null> => {
    try {
      // Render the CLIENT format (line items only, no internal breakdown) and
      // expand every room so all items show, then wait a beat for the re-render.
      setClientPdfMode(true);
      setExpandedRoom("all");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // LOW resolution + JPEG on purpose: this runs INSIDE the 3D editor tab,
      // which already holds the WebGL scene in memory. Rasterising a long BOQ at
      // MEDIUM produced a huge canvas and crashed the tab ("Out of Memory").
      // LOW keeps the attachment readable while cutting the pixel buffer sharply.
      const pdf: any = await generatePDF(targetRef, {
        resolution: Resolution.LOW,
        page: { margin: Margin.SMALL, format: "letter" },
        canvas: { mimeType: "image/jpeg", qualityRatio: 0.85 },
        overrides: { pdf: { compress: true }, canvas: { useCORS: true } },
        method: "build",
      });
      return pdf.output("blob");
    } catch (e) {
      console.error("getBoqPdfBlob failed", e);
      return null;
    } finally {
      // Restore the editing view (the PDF is already captured by now).
      setClientPdfMode(false);
    }
  }, [targetRef]);

  useEffect(() => {
    registerPdfGetter?.(getBoqPdfBlob);
  }, [registerPdfGetter, getBoqPdfBlob]);

  const handleExportAsPDF = async () => {
    setExpandedRoom("all");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pdfOptions: any = {
      resolution: Resolution.MEDIUM,
      page: { margin: Margin.SMALL, format: "letter" },
      canvas: { mimeType: "image/jpeg", qualityRatio: 0.98 },
      overrides: { pdf: { compress: false }, canvas: { useCORS: true } },
    };
    // Build the PDF (don't just open it) so we can BOTH download it for the user
    // AND archive it into the project Workspace as a "Quote" document.
    const pdf: any = await generatePDF(targetRef, {
      ...pdfOptions,
      method: "build",
    });
    const name = `Quote-${quoteNumber || "BOQ"}.pdf`;
    try {
      pdf.save(name);
    } catch (e) {
      console.error("pdf save failed", e);
    }
    // Archive to the workspace (best-effort — never block the download).
    try {
      if (projectId && pdf?.output) {
        const blob: Blob = pdf.output("blob");
        const file = new File([blob], name, { type: "application/pdf" });
        const up = await ProjectWorkspaceService.uploadFile(projectId, file);
        if (up) {
          await ProjectWorkspaceService.create({
            projectId,
            kind: "document",
            type: "Quote",
            title: `Quote ${quoteNumber || ""}`.trim(),
            fileUrl: up.fileUrl,
            mimeType: "application/pdf",
            note: "Auto-saved from BOQ",
          });
        }
      }
    } catch (e) {
      console.error("archive quote to workspace failed", e);
    }
    // NOTE: status is NOT advanced here. It moves to "quotation_sent" only when
    // the quote is actually EMAILED to the client (handleSendQuote below).
  };

  // Sending the quote to the client (email the BOQ PDF + advance status to
  // quotation_sent + archive it) is now part of the admin's single "Send to
  // client" action in the Renders & videos section — it uses this table's
  // getBoqPdfBlob for the PDF, so there's no separate quote button here.

  return (
    <>
      {!isLoading ? (
        <div className="pb-16 text-[#414063] h-screen overflow-y-auto">
          <div className="boq-title-container">
            <div className="boq-title">Bill of Quantity</div>
            <div className="boq-container">
              <button
                className={`boq-download-button ${
                  isLoading ? "text-[#aaaaaa]" : "text-[#414063]"
                }`}
                onClick={handleExportAsPDF}
                disabled={isLoading} // Optionally disable the button while loading
              >
                <img
                  height={20}
                  width={20}
                  src={
                    isLoading
                      ? require("../../images/download-disabled.svg")
                      : require("../../images/download.svg")
                  }
                  alt="Download Icon"
                />
                PDF
              </button>

              <button
                className={
                  isLoading
                    ? "ml-1.5 px-6 py-2 rounded border border-[#aaaaaa]"
                    : "ml-1.5 px-6 py-2 rounded border border-[#414063]"
                }
                disabled={isLoading}
                onClick={handleGenerateBoq}
              >
                <p
                  className={
                    "generate-boq-button-text " +
                    (isLoading ? "text-[#aaaaaa]" : "text-[#414063]")
                  }
                >
                  Generate BOQ
                </p>
              </button>

              {/* Approval workflow — there are NO quote buttons here anymore.
                  Both the architect's submit AND the admin's send-to-client are
                  single actions in the Renders & videos section below:
                    architect "Send to admin"  → BOQ + selected renders → pending approval
                    admin     "Send to client" → publishes renders AND emails the quote
                  so the BOQ, renders and quote all move together in one click. */}
            </div>
          </div>
          <div ref={targetRef}>
            <div className="gsw-paper">
              <div className="gsw-watermark">P</div>
              <div className="gsw-content">
                <div className="gsw-head">
                  <div className="gsw-brand">
                    <img
                      className="gsw-logo"
                      src={require("../../images/pazl.png")}
                      alt="PAZL"
                    />
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
                      <span className="gsw-v">
                        {clientInfoRows[2]?.value ?? "—"}
                      </span>
                    </div>
                    <div className="gsw-r">
                      <span className="gsw-k">Date</span>
                      <span className="gsw-v">
                        {clientInfoRows[0]?.value ?? "—"}
                      </span>
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
                    <div className="gsw-who">{clientInfoRows[3]?.value ?? "—"}</div>
                    <p>Address: {clientInfoRows[6]?.value ?? "—"}</p>
                    <p>
                      Phone: {clientInfoRows[4]?.value ?? "—"} · Email:{" "}
                      {clientInfoRows[5]?.value ?? "—"}
                    </p>
                    <p>Client GST: {clientInfoRows[7]?.value ?? "—"}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white m-4 text-surface shadow-secondary-1 dark:bg-surface-dark dark:text-white rounded gsw-table-wrap">
              <TableContainer component={Paper}>
                <Table aria-label="collapsible table">
                  <TableHead className="tableHead">
                    <TableRow>
                      <TableCell sx={{ width: "10%" }} align="center">
                        Room
                      </TableCell>
                      <TableCell sx={{ width: "30%" }} align="center">
                        Item
                      </TableCell>
                      <TableCell sx={{ width: "10%" }} align="center">
                        Unit Price
                      </TableCell>
                      <TableCell sx={{ width: "5%" }} align="center">
                        Qty
                      </TableCell>
                      <TableCell sx={{ width: "10%" }} align="center">
                        Total Price
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {groupedData.map((group, index) => (
                      <React.Fragment key={index}>
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            style={{
                              padding: "12px 8px",
                              borderBottom: "2px solid #17171b",
                            }}
                          >
                            <div
                              className="gsw-roomhead"
                              style={{ cursor: "pointer" }}
                              onClick={() => handleExpand(group.room)}
                            >
                              {clientPdfMode ? null : expandedRoom ===
                                group.room ? (
                                <KeyboardArrowUpIcon
                                  style={{ color: "#66666e", fontSize: 20 }}
                                />
                              ) : (
                                <KeyboardArrowDownIcon
                                  style={{ color: "#66666e", fontSize: 20 }}
                                />
                              )}
                              <span className="gsw-roomno">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <span className="gsw-roomname">{group.room}</span>
                              <span className="gsw-roomrule" />
                              <span className="gsw-roomtotal">
                                {money(
                                  group.items.reduce(
                                    (t, it) =>
                                      t +
                                      (parseFloat(
                                        (it.total_price || "₹0").slice(1)
                                      ) || 0),
                                    0
                                  )
                                )}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={5}>
                            <Collapse
                              in={
                                expandedRoom === group.room ||
                                expandedRoom === "all"
                              }
                              timeout="auto"
                              unmountOnExit
                            >
                              <Box sx={{ margin: 1 }}>
                                {group.items.map((item, itemIndex) => (
                                  <React.Fragment key={itemIndex}>
                                    <div className="gsw-item-head">
                                      <div className="gsw-item-main">
                                        {item.thumbnail ? (
                                          <img
                                            className="gsw-item-thumb"
                                            src={item.thumbnail}
                                            alt={item.item_name}
                                            onError={(e) => {
                                              (
                                                e.currentTarget as HTMLImageElement
                                              ).style.display = "none";
                                            }}
                                          />
                                        ) : null}
                                        <div className="gsw-item-info">
                                          <div
                                            className="gsw-item-name"
                                            dangerouslySetInnerHTML={{
                                              __html: item.item_description,
                                            }}
                                          />
                                          {item.flag ? (
                                            <div
                                              className={
                                                "gsw-item-flag" +
                                                (item.flag.startsWith("⚠")
                                                  ? " warn"
                                                  : "")
                                              }
                                            >
                                              {item.flag}
                                            </div>
                                          ) : null}
                                        </div>
                                      </div>
                                      <div className="gsw-item-nums">
                                        <div>
                                          <span className="gsw-nl">Unit</span>
                                          <span className="gsw-nv">
                                            {money(
                                              parseFloat(
                                                (item.unit_price || "₹0").slice(1)
                                              ) || 0
                                            )}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="gsw-nl">Qty</span>
                                          <span className="gsw-nv">
                                            {item.quantity}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="gsw-nl">Total</span>
                                          <span className="gsw-nv strong">
                                            {money(
                                              parseFloat(
                                                (item.total_price || "₹0").slice(
                                                  1
                                                )
                                              ) || 0
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    {!clientPdfMode && item.parts?.length ? (
                                      <div className="gsw-item-break">
                                          <PartsBreakdown
                                            parts={item.parts}
                                            extraHardware={
                                              hardwareByModel[
                                                item.furnishedModelId
                                              ] ??
                                              sumHardware(item.hardwareItems)
                                            }
                                          />
                                          {/* Per-object installation toggle */}
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: 8,
                                              fontSize: 12,
                                              margin: "2px 0 12px",
                                            }}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={!item.installationExcluded}
                                              onChange={() =>
                                                toggleInstallation(
                                                  item.furnishedModelId,
                                                  item.installationExcluded
                                                )
                                              }
                                            />
                                            <span
                                              style={{
                                                fontWeight: 600,
                                                color: "#6b7280",
                                              }}
                                            >
                                              Installation
                                            </span>
                                            <span
                                              style={{
                                                color: item.installationExcluded
                                                  ? "#9ca3af"
                                                  : "#111827",
                                              }}
                                            >
                                              {item.installationExcluded
                                                ? "excluded"
                                                : `${item.area ?? 0} ft² @ ₹${installationRate}/ft² = ${rupee(
                                                    (Number(item.area) || 0) *
                                                      installationRate
                                                  )}`}
                                            </span>
                                          </div>
                                          <HardwareEditor
                                            furnishedModelId={
                                              item.furnishedModelId
                                            }
                                            initialRows={
                                              item.hardwareItems || []
                                            }
                                            master={hardwareMaster}
                                            onChange={applyOtherCostChange}
                                            onSubtotal={(id, sub) =>
                                              setHardwareByModel((m) => ({
                                                ...m,
                                                [id]: sub,
                                              }))
                                            }
                                          />
                                          <OtherCostsEditor
                                            furnishedModelId={
                                              item.furnishedModelId
                                            }
                                            initialRows={item.otherCosts || []}
                                            onChange={applyOtherCostChange}
                                          />
                                      </div>
                                    ) : null}
                                  </React.Fragment>
                                ))}
                                <div className="gsw-room-total">
                                  <span>Total</span>
                                  <span>
                                    {money(
                                      group.items.reduce(
                                        (total, item) =>
                                          total +
                                          parseFloat(item.total_price.slice(1)),
                                        0
                                      )
                                    )}
                                  </span>
                                </div>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </div>
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
                      {includedArea} ft² @ ₹{installationRate}/ft²
                    </span>
                  </span>
                  <span className="gsw-v">{money(installationCost)}</span>
                </div>
                <div className="gsw-tl">
                  <span className="gsw-k">GST 18%</span>
                  <span className="gsw-v">₹{(0.18 * totalPrice).toFixed(2)}</span>
                </div>
                <div className="gsw-tl gross">
                  <span className="gsw-k">Gross total</span>
                  <span className="gsw-v">{money(grossTotalPrice)}</span>
                </div>
              </div>
              <div className="gsw-net">
                <div className="gsw-k">Net total</div>
                <div className="gsw-v">{money(grossTotalPrice)}</div>
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
      ) : (
        <div className="generate-boq-loader-container">
          <img src={require("../../images/spinner-loader.gif")} width={75} />
          <p className="loader-text">
            The Bill of Quantities (BOQ) table is currently loading. Please
            wait.
          </p>
        </div>
      )}
    </>
  );
};

export default BoqTable;
