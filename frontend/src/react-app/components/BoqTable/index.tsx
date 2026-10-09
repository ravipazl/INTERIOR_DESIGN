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
import { TexturesService } from "@pazl/services/texturesService";
import {
  LocalDBManager,
  LocalDBObjectStores,
} from "@pazl/services/LocalDBManager";
import { ProjectWorkspaceService } from "@pazl/services/ProjectWorkspaceService";
import { SyncService } from "@pazl/services/syncService";
import { Autocomplete } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KitchenOutlined from "@mui/icons-material/KitchenOutlined";
import WeekendOutlined from "@mui/icons-material/WeekendOutlined";
import BedOutlined from "@mui/icons-material/BedOutlined";
import BathtubOutlined from "@mui/icons-material/BathtubOutlined";
import TableRestaurantOutlined from "@mui/icons-material/TableRestaurantOutlined";
import DeskOutlined from "@mui/icons-material/DeskOutlined";
import HomeOutlined from "@mui/icons-material/HomeOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import RestoreOutlined from "@mui/icons-material/RestoreOutlined";
import CheckOutlined from "@mui/icons-material/CheckOutlined";
import CloseOutlined from "@mui/icons-material/CloseOutlined";

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
  /**
   * What the BOARD and the INSIDE are set to on this item right now, read off
   * its parts. The room's dropdowns show it, so opening a project tells you
   * what the room is made of instead of empty boxes above rows that plainly
   * say Plywood · Century · BWP.
   */
  applied?: {
    typeId: string;
    brandId: string;
    grade: string;
    intCatId: string;
    intBrandId: string;
    // The outside, when every mesh of the item carries the same one.
    extFinishId?: string;
    extBrandId?: string;
  };
  area?: number;
  installationExcluded?: boolean;
  /** Calculated price per unit (parts + hardware + other costs). */
  basePrice?: number;
  /** BOQ line overrides (saved on the placed item; the design is untouched). */
  boqQty?: number;
  boqRate?: number | null;
  boqExcluded?: boolean;
  /** Free-text description written on the BOQ page ("" = none). */
  boqDescription?: string;
  /** Edited rate per sq.ft (area-priced lines); null = calculated. */
  boqSqftRate?: number | null;
  categoryName?: string;
  /** One unit's size in mm (from the item's [H, W, D]). */
  widthMm?: number;
  heightMm?: number;
  /** One unit's width / height in ft set on the BOQ page; null = 3D size. */
  boqWidthFt?: number | null;
  boqHeightFt?: number | null;
  unit?: string;
  material?: string;
  dims?: string;
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

// ── BOQ line maths ──────────────────────────────────────────────────────────
// Each placed item is a unit. Identical units (same item, size and material in
// a room) show as ONE line, e.g. 4 Tall Units → Qty 4. Cabinets are priced by
// the area of their front: Width (unit width × qty) × Height = Area,
// Area × Rate per sq.ft = Amount. Loose items (decor, lamps…) stay per no.
// Removed lines are not counted anywhere.
const SQFT_ITEM =
  /\b(tall|wall|base)\s*units?\b|below\s*counter|pull\s*-?\s*out|\bloft|wardrobe|drawer\s*unit|sink\s*unit|corner\s*unit|crockery|vanity/i;
const round2 = (n: number) => Number((Number(n) || 0).toFixed(2));
const mmToFt = (mm?: number) => round2((Number(mm) || 0) / 304.8);
// One unit's width / height in ft: the size set on the BOQ page, else the
// size from the 3D design (rounded to 0.01 ft, as shown).
const hasSize = (v: any) => v !== null && v !== undefined && Number(v) > 0;
const unitWidthFt = (it: TableRowType) =>
  hasSize(it.boqWidthFt) ? Number(it.boqWidthFt) : mmToFt(it.widthMm);
const unitHeightFt = (it: TableRowType) =>
  hasSize(it.boqHeightFt) ? Number(it.boqHeightFt) : mmToFt(it.heightMm);
// Installation area of one unit = its BOQ area (Width × Height); an item with
// no size keeps the area it was loaded with (the sum of its parts).
const unitArea = (it: TableRowType) =>
  unitWidthFt(it) > 0 && unitHeightFt(it) > 0
    ? round2(unitWidthFt(it) * unitHeightFt(it))
    : Number(it.area) || 0;
// Quantity of one placed unit (1 unless changed on the BOQ page).
const lineQty = (it: TableRowType) =>
  Number(it.boqQty) > 0 ? Number(it.boqQty) : 1;
// Hardware + other costs of one unit (added on top of the line amount).
const unitExtras = (it: TableRowType) =>
  round2(
    (it.hardwareItems || []).reduce(
      (s, r) => s + (Number(r?.qty) || 0) * (Number(r?.unitPrice) || 0),
      0
    ) +
      (it.otherCosts || []).reduce((s, r) => s + (Number(r?.amount) || 0), 0)
  );
// Per-no rate of one unit WITHOUT its hardware / other costs: the edited
// rate, else the calculated price (which includes them) minus them.
const unitCoreRate = (it: TableRowType) =>
  it.boqRate === null || it.boqRate === undefined
    ? Math.max(0, (Number(it.basePrice) || 0) - unitExtras(it))
    : Number(it.boqRate) || 0;

interface BoqLine {
  /** First unit's id — identifies the line for editing / expanding. */
  id: string;
  ids: string[];
  units: TableRowType[];
  lead: TableRowType;
  excluded: boolean;
  bySqft: boolean;
  qty: number;
  /** One unit's width and the line's height, in feet. */
  unitWidth: number;
  height: number;
  overallWidth: number;
  /** Width / height set on the BOQ page (not the 3D size). */
  widthEdited: boolean;
  heightEdited: boolean;
  /** Sq.ft (area-priced lines only). */
  area: number;
  /** ₹ per sq.ft, or ₹ per no for loose items. */
  rate: number;
  rateEdited: boolean;
  /** Hardware + other costs of all units, included in the amount. */
  extras: number;
  /** Area × rate (or qty × rate) + extras. */
  amount: number;
  description: string;
}

const lineFromUnits = (units: TableRowType[]): BoqLine => {
  const lead = units[0];
  const qty = round2(units.reduce((q, u) => q + lineQty(u), 0));
  // Unrounded unit width, so Width = unit width × qty adds up exactly
  // (10 ft over 3 units stays 10, not 9.99).
  const unitWidthRaw = unitWidthFt(lead);
  const unitWidth = round2(unitWidthRaw);
  const height = round2(Math.max(...units.map(unitHeightFt)));
  const widthEdited = units.some((u) => hasSize(u.boqWidthFt));
  const heightEdited = units.some((u) => hasSize(u.boqHeightFt));
  // Calculated amount = what each unit costs today (without hardware / other
  // costs) × its quantity. Hardware and other costs are added on top.
  const calculated = units.reduce((t, u) => t + lineQty(u) * unitCoreRate(u), 0);
  const extras = round2(units.reduce((t, u) => t + lineQty(u) * unitExtras(u), 0));
  const bySqft =
    SQFT_ITEM.test(`${lead.categoryName || ""} ${lead.item_name || ""}`) &&
    unitWidth > 0 &&
    height > 0;
  let overallWidth = 0;
  let area = 0;
  let rate: number;
  let rateEdited: boolean;
  let amount: number;
  if (bySqft) {
    overallWidth = round2(unitWidthRaw * qty);
    area = round2(overallWidth * height);
    const set = units.find(
      (u) => u.boqSqftRate !== null && u.boqSqftRate !== undefined
    );
    rateEdited = !!set;
    // Default rate per sq.ft comes from the calculated price, so the amount
    // matches what the item costs until someone changes the rate.
    rate = set
      ? Number(set.boqSqftRate) || 0
      : area > 0
      ? round2(calculated / area)
      : 0;
    amount = round2(area * rate + extras);
  } else {
    rateEdited = units.some(
      (u) => u.boqRate !== null && u.boqRate !== undefined
    );
    rate = qty > 0 ? round2(calculated / qty) : 0;
    amount = round2(calculated + extras);
  }
  return {
    id: lead.furnishedModelId || "",
    ids: units.map((u) => u.furnishedModelId || "").filter(Boolean),
    units,
    lead,
    excluded: !!lead.boqExcluded,
    bySqft,
    qty,
    unitWidth,
    height,
    overallWidth,
    widthEdited,
    heightEdited,
    area,
    rate,
    rateEdited,
    extras,
    amount,
    description: units.find((u) => u.boqDescription)?.boqDescription || "",
  };
};

// Merge a room's units into lines (first-seen order).
const buildLines = (items: TableRowType[]): BoqLine[] => {
  const byKey = new Map<string, TableRowType[]>();
  for (const it of items) {
    const key = [
      it.item_name,
      Math.round(Number(it.widthMm) || 0),
      Math.round(Number(it.heightMm) || 0),
      it.boqWidthFt ?? "",
      it.boqHeightFt ?? "",
      it.material || "",
      it.boqExcluded ? 1 : 0,
    ].join("|");
    const list = byKey.get(key);
    if (list) list.push(it);
    else byKey.set(key, [it]);
  }
  return Array.from(byKey.values()).map(lineFromUnits);
};

const groupAmount = (g: GroupedDataRow) =>
  round2(
    buildLines(g.items).reduce((t, l) => t + (l.excluded ? 0 : l.amount), 0)
  );
// Numbers inside the table: grouped, no currency sign (the header says ₹).
const plain = (n: number) =>
  (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const formatQty = (n: number) =>
  Number.isInteger(n) ? String(n) : (Number(n) || 0).toFixed(2);

// "W × H" in feet from the item's [H, W, D] millimetres.
const toFeet = (mm: number) => {
  const ft = (Number(mm) || 0) / 304.8;
  return ft >= 10 || Number.isInteger(Number(ft.toFixed(1)))
    ? String(Math.round(ft * 10) / 10)
    : ft.toFixed(1);
};
const dimsInFeet = (dimensions: number[]) =>
  Array.isArray(dimensions) && dimensions.length >= 2
    ? `${toFeet(dimensions[1])} ft (W) × ${toFeet(dimensions[0])} ft (H)`
    : "";

// Room section icon from the room's name (falls back to a house).
const roomIconFor = (name: string) => {
  const n = String(name || "").toLowerCase();
  if (/kitchen|pantry|utility/.test(n)) return KitchenOutlined;
  if (/bed/.test(n)) return BedOutlined;
  if (/bath|toilet|wash|powder/.test(n)) return BathtubOutlined;
  if (/dining/.test(n)) return TableRestaurantOutlined;
  if (/study|office|work/.test(n)) return DeskOutlined;
  if (/living|lounge|family|hall/.test(n)) return WeekendOutlined;
  return HomeOutlined;
};

// Money with exactly 2 decimals (avoids floating-point tails like
// ₹17760.489999999998). e.g. money(17760.489999) -> "₹17,760.49".
const money = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// ── Hardware & Other Costs (per placed unit) ─────────────────────────────────
// Both are added ON TOP of the line amount (Area × Rate + Hardware + Other
// Costs). Each change is saved to the unit; once the save succeeds the new rows
// and the change in their total are reported up, so the BOQ totals update
// without regenerating the BOQ.
type HardwareRow = {
  name: string;
  unitPrice: number;
  qty: number;
  fromMaster?: boolean;
};
type CostRow = { label: string; amount: number };
type ExtrasSaved<T> = (furnishedModelId: string, rows: T[], delta: number) => void;

const sumHardwareRows = (rows: any[]) =>
  round2(
    (rows || []).reduce(
      (s, r) => s + (Number(r?.qty) || 0) * (Number(r?.unitPrice) || 0),
      0
    )
  );
const sumCostRows = (rows: any[]) =>
  round2((rows || []).reduce((s, r) => s + (Number(r?.amount) || 0), 0));

const OtherCostsEditor: React.FC<{
  furnishedModelId?: string;
  initialRows: CostRow[];
  onSaved: ExtrasSaved<CostRow>;
}> = ({ furnishedModelId, initialRows, onSaved }) => {
  const [rows, setRowsState] = useState<{ label: string; amount: any }[]>(
    initialRows?.length ? initialRows : []
  );
  // Latest rows (read by saves) and the last saved rows, so unchanged blurs
  // don't save again. Saves run one at a time.
  const rowsRef = useRef(rows);
  const setRows = (next: { label: string; amount: any }[]) => {
    rowsRef.current = next;
    setRowsState(next);
  };
  const saved = useRef<CostRow[]>(initialRows || []);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const persist = () => {
    queue.current = queue.current.then(save).catch(() => undefined);
  };

  const save = async () => {
    if (!furnishedModelId) return;
    const clean: CostRow[] = rowsRef.current
      .filter((r) => (r.label || "").trim() !== "" || Number(r.amount))
      .map((r) => ({
        label: (r.label || "").trim() || "Other cost",
        amount: round2(Number(r.amount) || 0),
      }));
    if (JSON.stringify(clean) === JSON.stringify(saved.current)) return;
    const ok = await FurnishedModelsService.updateOtherCosts(
      furnishedModelId,
      clean
    );
    if (!ok) {
      alert("Other costs could not be saved. Please try again.");
      return;
    }
    onSaved(
      furnishedModelId,
      clean,
      round2(sumCostRows(clean) - sumCostRows(saved.current))
    );
    saved.current = clean;
  };

  const subtotal = sumCostRows(rows);
  return (
    <div className="bq-extras">
      <div className="bq-extras-head">
        <span>Other Costs</span>
        {subtotal ? (
          <span className="bq-extras-total">
            Total <b>{money(subtotal)}</b>
          </span>
        ) : null}
      </div>
      {rows.length ? (
        <div className="bq-xrow bq-xlabels">
          <span className="bq-xspan">Label</span>
          <span className="r">Amount (₹)</span>
          <span />
        </div>
      ) : null}
      {rows.map((row, i) => (
        <div key={i} className="bq-xrow">
          <input
            className="bq-xinput bq-xspan"
            placeholder="e.g. Edge banding"
            aria-label="Cost label"
            value={row.label}
            onChange={(e) =>
              setRows(
                rows.map((r, idx) =>
                  idx === i ? { ...r, label: e.target.value } : r
                )
              )
            }
            onBlur={() => persist()}
          />
          <input
            className="bq-xinput r"
            type="number"
            min={0}
            step="0.01"
            placeholder="0"
            aria-label="Cost amount"
            value={row.amount}
            onChange={(e) =>
              setRows(
                rows.map((r, idx) =>
                  idx === i ? { ...r, amount: e.target.value } : r
                )
              )
            }
            onBlur={() => persist()}
          />
          <button
            type="button"
            className="bq-xdel"
            title="Remove cost"
            aria-label="Remove cost"
            onClick={() => {
              const next = rows.filter((_, idx) => idx !== i);
              setRows(next);
              persist();
            }}
          >
            <CloseOutlined style={{ fontSize: 14 }} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="bq-xadd"
        onClick={() => setRows([...rows, { label: "", amount: "" }])}
      >
        + Add cost
      </button>
    </div>
  );
};

// Hardware lines: pick an item from the Hardware master (its price fills in)
// or type any name; the price and quantity can always be typed.
// Line total = price × qty.
const HardwareEditor: React.FC<{
  furnishedModelId?: string;
  initialRows: HardwareRow[];
  master: { _id: string; name: string; price: number }[];
  onSaved: ExtrasSaved<HardwareRow>;
}> = ({ furnishedModelId, initialRows, master, onSaved }) => {
  const [rows, setRowsState] = useState<any[]>(
    initialRows?.length ? initialRows.map((r) => ({ ...r })) : []
  );
  const rowsRef = useRef(rows);
  const setRows = (next: any[]) => {
    rowsRef.current = next;
    setRowsState(next);
  };
  const saved = useRef<HardwareRow[]>(initialRows || []);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const persist = () => {
    queue.current = queue.current.then(save).catch(() => undefined);
  };

  const save = async () => {
    if (!furnishedModelId) return;
    const clean: HardwareRow[] = rowsRef.current
      .filter(
        (r) => (r.name || "").trim() !== "" || Number(r.unitPrice) > 0
      )
      .map((r) => ({
        name: (r.name || "").trim() || "Hardware",
        unitPrice: round2(Number(r.unitPrice) || 0),
        qty: Number(r.qty) > 0 ? round2(Number(r.qty)) : 0,
        fromMaster: !!r.fromMaster,
      }));
    if (JSON.stringify(clean) === JSON.stringify(saved.current)) return;
    const ok = await FurnishedModelsService.updateHardwareItems(
      furnishedModelId,
      clean
    );
    if (!ok) {
      alert("Hardware could not be saved. Please try again.");
      return;
    }
    onSaved(
      furnishedModelId,
      clean,
      round2(sumHardwareRows(clean) - sumHardwareRows(saved.current))
    );
    saved.current = clean;
  };

  const setRow = (i: number, patch: any) =>
    setRows(
      rowsRef.current.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    );

  const subtotal = sumHardwareRows(rows);
  return (
    <div className="bq-extras">
      <div className="bq-extras-head">
        <span>Hardware</span>
        {subtotal ? (
          <span className="bq-extras-total">
            Total <b>{money(subtotal)}</b>
          </span>
        ) : null}
      </div>
      {rows.length ? (
        <div className="bq-xrow bq-xlabels">
          <span>Item</span>
          <span className="r">Price (₹)</span>
          <span className="r">Qty</span>
          <span className="r">Total (₹)</span>
          <span />
        </div>
      ) : null}
      {rows.map((row, i) => (
        <div key={i} className="bq-xrow">
          <Autocomplete
            freeSolo
            size="small"
            disablePortal
            options={master || []}
            value={row.name || null}
            inputValue={row.name || ""}
            getOptionLabel={(o: any) =>
              typeof o === "string" ? o : o?.name || ""
            }
            isOptionEqualToValue={(o: any, v: any) =>
              typeof v === "string" ? o?.name === v : o?._id === v?._id
            }
            renderOption={(props, o: any) => (
              <li {...props} key={o._id}>
                <span style={{ flex: 1 }}>{o.name}</span>
                <span style={{ color: "#6b7280", marginLeft: 12 }}>
                  ₹{o.price}
                </span>
              </li>
            )}
            onInputChange={(_e, value, reason) => {
              if (reason === "input" || reason === "clear") {
                setRow(i, { name: value, fromMaster: false });
              }
            }}
            onChange={(_e, val: any) => {
              if (val && typeof val === "object") {
                // Picked from the master: its name and price fill in; the
                // price stays editable.
                const next = rows.map((r, idx) =>
                  idx === i
                    ? {
                        ...r,
                        name: val.name,
                        unitPrice: val.price,
                        fromMaster: true,
                      }
                    : r
                );
                setRows(next);
                persist();
              }
            }}
            onBlur={() => persist()}
            renderInput={(params) => (
              <div ref={params.InputProps.ref}>
                <input
                  {...params.inputProps}
                  className="bq-xinput"
                  placeholder="Search or type hardware…"
                  aria-label="Hardware item"
                />
              </div>
            )}
            sx={{ minWidth: 0 }}
          />
          <input
            className="bq-xinput r"
            type="number"
            min={0}
            step="0.01"
            placeholder="0"
            aria-label="Hardware price"
            value={row.unitPrice ?? ""}
            onChange={(e) => setRow(i, { unitPrice: e.target.value })}
            onBlur={() => persist()}
          />
          <input
            className="bq-xinput r"
            type="number"
            min={0}
            step="1"
            placeholder="1"
            aria-label="Hardware quantity"
            value={row.qty ?? ""}
            onChange={(e) => setRow(i, { qty: e.target.value })}
            onBlur={() => persist()}
          />
          <span className="r bq-xtotal">
            {plain((Number(row.qty) || 0) * (Number(row.unitPrice) || 0))}
          </span>
          <button
            type="button"
            className="bq-xdel"
            title="Remove hardware"
            aria-label="Remove hardware"
            onClick={() => {
              const next = rows.filter((_, idx) => idx !== i);
              setRows(next);
              persist();
            }}
          >
            <CloseOutlined style={{ fontSize: 14 }} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="bq-xadd"
        onClick={() =>
          setRows([
            ...rows,
            { name: "", unitPrice: "", qty: 1, fromMaster: false },
          ])
        }
      >
        + Add hardware
      </button>
    </div>
  );
};

/**
 * THE ROOM'S BOARD — type, brand and grade.
 *
 * Plywood · Century · BWP. Separate from the finish above: the finish is the
 * surface you see, this is the sheet underneath, and the two come from
 * different suppliers and different catalogues.
 *
 * Grade belongs to the TYPE — each core material type carries its own list, so
 * BWP is offered under plywood and not under something that has no such grade.
 */
export interface RoomMatChoice {
  // the board
  typeId: string;
  brandId: string;
  grade: string;
  // the inside
  intCatId: string;
  intBrandId: string;
  // the outside
  extTypeId: string;
  extStyleId: string;
  extFinishId: string;
  extBrandId: string;
  /**
   * WHICH SECTIONS "APPLY TO ALL" WRITES.
   *
   * It used to be "whichever sections are filled in" — and the dialog opens
   * already filled in with what the room has. So changing only the board
   * grade also rewrote the interior and, worse, the exterior on every mesh,
   * wiping out finishes set one by one in the 3D view. Nothing on screen said
   * so. A filled field now means only "this is the current value"; a tick
   * means "write this".
   */
  applyCore: boolean;
  applyInt: boolean;
  applyExt: boolean;
}
export const blankRoomMat: RoomMatChoice = {
  // Unticked to start with: nothing is written unless it was chosen.
  applyCore: false,
  applyInt: false,
  applyExt: false,
  typeId: "",
  brandId: "",
  grade: "",
  intCatId: "",
  intBrandId: "",
  extTypeId: "",
  extStyleId: "",
  extFinishId: "",
  extBrandId: "",
};

/**
 * WHAT A ROOM IS ALREADY MADE OF, read off its items.
 *
 * A field is filled only when every item in the room agrees on it. Showing the
 * first item's value where they differ would state as fact something true of
 * one cabinet out of ten — and the dialog overwrites all of them, so a wrong
 * reading here becomes a wrong write. Where they disagree the box stays empty,
 * which is honest: there is no single answer.
 *
 * Core and interior only. The exterior is a per-mesh choice, so a room rarely
 * has one, and the dialog's exterior cascade is picked from the top anyway.
 */
const appliedMatFor = (lines: BoqLine[]): RoomMatChoice => {
  const all = lines
    .flatMap((l) => l.units.map((u) => u.applied))
    .filter(Boolean) as NonNullable<BoqLine["units"][number]["applied"]>[];
  if (!all.length) return blankRoomMat;
  const agreed = (k: keyof (typeof all)[number]) => {
    const first = all[0][k] || "";
    return all.every((a) => (a[k] || "") === first) ? first : "";
  };
  return {
    ...blankRoomMat,
    typeId: agreed("typeId"),
    brandId: agreed("brandId"),
    grade: agreed("grade"),
    intCatId: agreed("intCatId"),
    intBrandId: agreed("intBrandId"),
    // Type and style are not stored on a part — only the finish is — so the
    // dialog works them out from the finish once its lists have loaded.
    extFinishId: agreed("extFinishId"),
    extBrandId: agreed("extBrandId"),
  };
};

/**
 * CHANGE ONE MESH'S EXTERIOR, FROM THE BILL.
 *
 * The exterior is a per-MESH decision — a shutter in oak, a side panel
 * laminated only where it is seen — and the 3D view remains the place it is
 * designed, because there you click the thing you can see. This is for the
 * parts that were not done there, and for a correction made while reading the
 * bill.
 *
 * Type -> Style -> Finish -> Brand, each list derived from the one above, so a
 * combination that does not exist cannot be chosen.
 */
const MeshFinishPicker: React.FC<{
  label: string;
  busy: boolean;
  /** What the part is finished in now, so the form opens showing it. */
  currentFinishingId?: string | null;
  currentBrandId?: string | null;
  onCancel: () => void;
  onApply: (choice: {
    finishingId: string;
    brandId: string | null;
    classification: string;
  }) => void;
}> = ({
  label,
  busy,
  currentFinishingId,
  currentBrandId,
  onCancel,
  onApply,
}) => {
  const [cats, setCats] = useState<any[]>([]);
  const [finishes, setFinishes] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [typeId, setTypeId] = useState("");
  const [styleId, setStyleId] = useState("");
  const [finishId, setFinishId] = useState("");
  const [brandId, setBrandId] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, f, b] = await Promise.all([
          TexturesService.getAllFinishingCategories(),
          TexturesService.getAllFinishings(),
          TexturesService.getAllFinishingBrands?.() ?? Promise.resolve([]),
        ]);
        if (!alive) return;
        // Paginated bodies — { total, limit, skip, data: [...] }, not the array.
        const list = (r: any): any[] =>
          Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
        setCats(list(c));
        setFinishes(list(f));
        setBrands(list(b));
      } catch (e) {
        /* an empty picker beats a broken row */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const types = cats.filter((c) => c && !c.parentCategoryId);
  const styles = cats.filter((c) => c && c.parentCategoryId === typeId);

  /**
   * OPEN ON WHAT THE PART ALREADY HAS.
   *
   * Reopening Edit on a finished part showed four empty boxes, which reads as
   * "nothing is set" on a part that plainly costs ₹550/sq.ft — and to change
   * only the brand you had to re-pick the type, style and swatch from memory.
   *
   * The part knows its finishing id; the type and style are derived from it:
   * the finishing names its category (the style), and that category's parent is
   * the type. Done once, when the catalogue arrives, and only while the user
   * has not touched anything — re-running it would fight every selection.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !cats.length || !finishes.length) return;
    seeded.current = true;
    if (currentBrandId) setBrandId(currentBrandId);
    const fin = currentFinishingId
      ? finishes.find((f) => f && f._id === currentFinishingId)
      : null;
    if (!fin) return;
    const style = cats.find((c) => c && c._id === fin.categoryId);
    // A finishing hangs off a STYLE, whose parent is the type. Where it hangs
    // off a top-level category directly, that category is the type and there is
    // no style to select.
    if (style?.parentCategoryId) {
      setTypeId(style.parentCategoryId);
      setStyleId(style._id);
    } else if (style) {
      setTypeId(style._id);
    }
    setFinishId(fin._id);
  }, [cats, finishes, currentFinishingId, currentBrandId]);

  // ONE OPTION IS NOT A CHOICE. The catalogue has a single top-level category,
  // so waiting for it to be "chosen" leaves Style and Finish empty on arrival,
  // which reads as a broken form rather than a cascade.
  useEffect(() => {
    if (!typeId && types.length === 1) setTypeId(types[0]._id);
  }, [typeId, types]);
  const inStyle = finishes.filter((f) => f && f.categoryId === styleId);
  const chosen = inStyle.find((f) => f._id === finishId) || null;

  const sel = (
    text: string,
    value: string,
    onChange: (v: string) => void,
    list: any[],
    waitingFor?: string
  ) => (
    <label className="bq-mesh-field">
      <span className="bq-mesh-lab">{text}</span>
      <select
        className="bq-input"
        value={value}
        disabled={busy || !list.length}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {list.length ? `Select ${text.toLowerCase()}` : waitingFor || "None"}
        </option>
        {list.map((o) => (
          <option key={o._id} value={o._id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="bq-mesh-edit">
      <span className="bq-mesh-target">{label}</span>
      {sel("Type", typeId, (v) => {
        setTypeId(v);
        setStyleId("");
        setFinishId("");
      }, types)}
      {sel("Style", styleId, (v) => {
        setStyleId(v);
        setFinishId("");
      }, styles, "Choose a type first")}
      {sel("Finish", finishId, setFinishId, inStyle, "Choose a style first")}
      {sel("Brand", brandId, setBrandId, brands)}
      <button type="button" className="bq-link" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      <button
        type="button"
        className="bq-primary"
        disabled={busy || !chosen}
        onClick={() =>
          chosen &&
          onApply({
            finishingId: chosen._id,
            // "" would be stored as an empty string and never match a rate
            // lookup; null is the value that means "no brand".
            brandId: brandId || null,
            classification: types.find((t) => t._id === typeId)?.name || "",
          })
        }
      >
        {busy ? "Saving…" : "Apply to this part"}
      </button>
    </div>
  );
};

/**
 * ONE POPUP FOR EVERYTHING A ROOM IS MADE OF.
 *
 * The board, the lining and the outside finish used to be six dropdowns strung
 * across the room header, with the exterior missing entirely because there was
 * no width left for it. Three sections in a dialog give each one the room to
 * show its own cascade, and the header goes back to being a header.
 *
 * EACH SECTION IS OPTIONAL. Fill one and only that one is written, so changing
 * a room's board does not mean restating its finishes. Apply enables as soon as
 * anything is set.
 *
 * The three cascades differ because the materials do:
 *
 *   Core      Material -> Board brand -> Grade   (grades belong to the material:
 *             plywood has BWP, MR and Commercial; WPC has none)
 *   Interior  Finish type -> Brand               (no grade — the inside is white
 *             inner lamination, there is no decor to choose)
 *   Exterior  Type -> Style -> Finish -> Brand   (an actual swatch is picked)
 */
const RoomMaterialModal: React.FC<{
  room: string;
  items: number;
  busy: boolean;
  value: RoomMatChoice;
  onChange: (next: RoomMatChoice) => void;
  onCancel: () => void;
  onApply: () => void;
}> = ({ room, items, busy, value, onChange, onCancel, onApply }) => {
  const [coreTypes, setCoreTypes] = useState<any[]>([]);
  const [coreBrands, setCoreBrands] = useState<any[]>([]);
  const [finCats, setFinCats] = useState<any[]>([]);
  const [finBrands, setFinBrands] = useState<any[]>([]);
  const [finishes, setFinishes] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ct, cb, fc, fb, fn] = await Promise.all([
          TexturesService.getAllCoreMaterialTypes(),
          TexturesService.getAllCoreMaterialBrands(),
          TexturesService.getAllFinishingCategories(),
          TexturesService.getAllFinishingBrands?.() ?? Promise.resolve([]),
          TexturesService.getAllFinishings(),
        ]);
        if (!alive) return;
        // Paginated bodies — { total, limit, skip, data: [...] }, not the array.
        const list = (r: any): any[] =>
          Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
        setCoreTypes(list(ct));
        setCoreBrands(list(cb));
        setFinCats(list(fc));
        setFinBrands(list(fb));
        setFinishes(list(fn));
      } catch (e) {
        /* an empty dialog beats a broken page */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Changing a field ticks its own section: whoever picks a different board
  // meant to apply it, and making them also find the checkbox is a step that
  // only ever gets forgotten. It never UNticks anything, and it never touches
  // another section's tick.
  const set = (patch: Partial<RoomMatChoice>) => {
    const keys = Object.keys(patch);
    const touched = (...names: string[]) => keys.some((k) => names.includes(k));
    onChange({
      ...value,
      ...patch,
      applyCore: value.applyCore || touched("typeId", "brandId", "grade"),
      applyInt: value.applyInt || touched("intCatId", "intBrandId"),
      applyExt:
        value.applyExt ||
        touched("extTypeId", "extStyleId", "extFinishId", "extBrandId"),
    });
  };
  // The tick itself is set directly, so it can be cleared again.
  const tick = (patch: Partial<RoomMatChoice>) => onChange({ ...value, ...patch });

  /**
   * Show the exterior the room already has, as Core and Interior do.
   *
   * A part stores only its FINISH. The Type and Style dropdowns above it are
   * the finish's own grade and that grade's parent, so they are read back from
   * the finish once the lists have arrived — without them the saved finish
   * could not be displayed at all, since each dropdown only lists what the one
   * above it allows, and the section opened blank after every apply.
   *
   * Through onChange, NOT set(): this is the dialog describing what is there,
   * not the user choosing something, so it must not tick the section.
   */
  useEffect(() => {
    if (!value.extFinishId || value.extStyleId) return;
    const fin = finishes.find((f) => f && f._id === value.extFinishId);
    const style = fin && finCats.find((c) => c && c._id === fin.categoryId);
    if (!style) return;
    onChange({
      ...value,
      extStyleId: style._id,
      extTypeId: style.parentCategoryId || style._id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.extFinishId, value.extStyleId, finishes.length, finCats.length]);

  // Grades hang off the chosen board.
  const grades: string[] =
    coreTypes.find((t) => t._id === value.typeId)?.grades || [];

  const topCats = finCats.filter((c) => c && !c.parentCategoryId);
  // THE INSIDE IS LAMINATE, AND ONLY LAMINATE. Offering Paint and Glass here
  // would be two choices that can only price a surface that does not exist.
  // Matched on the name so a type added later is picked up without a change;
  // falls back to every type rather than leaving an empty dropdown.
  const interiorTypes = (() => {
    const lam = topCats.filter((c) => /lamina/i.test(c.name || ""));
    return lam.length ? lam : topCats;
  })();
  const extStyles = finCats.filter(
    (c) => c && c.parentCategoryId && c.parentCategoryId === value.extTypeId
  );
  const extFinishes = finishes.filter(
    (f) => f && f.categoryId === value.extStyleId
  );

  const coreReady =
    !!value.typeId && !!value.brandId && (!!value.grade || grades.length === 0);
  const interiorReady = !!value.intCatId;
  const exteriorReady = !!value.extFinishId;
  // A section is applied only when it is BOTH ticked and complete. A ticked
  // section that is half filled in blocks the button rather than being
  // skipped quietly — skipping it would look like it had been applied.
  const willCore = value.applyCore && coreReady;
  const willInt = value.applyInt && interiorReady;
  const willExt = value.applyExt && exteriorReady;
  const incomplete = [
    value.applyCore && !coreReady ? "Core material" : null,
    value.applyInt && !interiorReady ? "Interior" : null,
    value.applyExt && !exteriorReady ? "Exterior" : null,
  ].filter(Boolean) as string[];
  const anything = (willCore || willInt || willExt) && !incomplete.length;

  // Heading with its checkbox. Any combination may be ticked — one section or
  // several — and ticking one never clears another.
  const section = (
    title: string,
    on: boolean,
    key: "applyCore" | "applyInt" | "applyExt"
  ) => (
    <label className="bq-modal-sec bq-rm-sec">
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        onChange={(e) => tick({ [key]: e.target.checked })}
      />
      <span>{title}</span>
      {!on ? <span className="bq-rm-skip">not applied</span> : null}
    </label>
  );

  const field = (
    label: string,
    v: string,
    onPick: (next: string) => void,
    list: any[],
    display: (o: any) => string,
    placeholder: string,
    waitingFor?: string
  ) => (
    <label className="bq-rm-field">
      <span className="bq-rm-lab">{label}</span>
      <select
        className="bq-input"
        value={v}
        disabled={busy || !list.length}
        onChange={(e) => onPick(e.target.value)}
      >
        <option value="">{list.length ? placeholder : waitingFor || "None"}</option>
        {list.map((o) => (
          <option key={o._id ?? o} value={o._id ?? o}>
            {display(o)}
          </option>
        ))}
      </select>
    </label>
  );

  const name = (o: any) => o?.name ?? String(o);

  return (
    <div className="bq-modal-back" onClick={busy ? undefined : onCancel}>
      <div className="bq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bq-modal-head">
          <b>Material configuration</b>
          <div className="bq-modal-sub">
            {room || "Room"} · applies to every part of {items} item
            {items === 1 ? "" : "s"}
          </div>
        </div>

        <div className="bq-modal-body">
          {section("Core material", value.applyCore, "applyCore")}
          <div className={`bq-rm-grid3${value.applyCore ? "" : " bq-rm-off"}`}>
            {field(
              "Material",
              value.typeId,
              // The grade belongs to the OLD board, so it is cleared with it.
              (v) => set({ typeId: v, grade: "" }),
              coreTypes,
              (o) => o.type || o.name,
              "Leave unchanged"
            )}
            {field("Board brand", value.brandId, (v) => set({ brandId: v }), coreBrands, name, "Select brand")}
            {field(
              "Grade",
              value.grade,
              (v) => set({ grade: v }),
              grades,
              (g) => String(g),
              "Select grade",
              value.typeId ? "No grades for this material" : "Choose a material first"
            )}
          </div>

          {section("Interior", value.applyInt, "applyInt")}
          <div className={`bq-rm-grid2${value.applyInt ? "" : " bq-rm-off"}`}>
            {field("Finish type", value.intCatId, (v) => set({ intCatId: v }), interiorTypes, name, "Leave unchanged")}
            {field("Brand", value.intBrandId, (v) => set({ intBrandId: v }), finBrands, name, "Any brand")}
          </div>

          {section("Exterior", value.applyExt, "applyExt")}
          <div className={`bq-rm-grid2${value.applyExt ? "" : " bq-rm-off"}`}>
            {field(
              "Type",
              value.extTypeId,
              // Style and swatch belong to the old type.
              (v) => set({ extTypeId: v, extStyleId: "", extFinishId: "" }),
              topCats,
              name,
              "Leave unchanged"
            )}
            {field(
              "Style",
              value.extStyleId,
              (v) => set({ extStyleId: v, extFinishId: "" }),
              extStyles,
              name,
              "Select style",
              "Choose a type first"
            )}
            {field("Finish", value.extFinishId, (v) => set({ extFinishId: v }), extFinishes, name, "Select finish", "Choose a style first")}
            {field("Brand", value.extBrandId, (v) => set({ extBrandId: v }), finBrands, name, "Select brand")}
          </div>
          {willExt ? (
            /* THE ONE DESTRUCTIVE CHOICE HERE. The exterior is a per-mesh
               property — a shutter in oak beside a plain carcass — so writing
               it at room level replaces every mesh, including anything set in
               the 3D view. Said before it is pressed, not discovered after. */
            <div className="bq-rm-warn">
              Replaces the exterior on every mesh, including any set in the 3D view
            </div>
          ) : null}
        </div>

        <div className="bq-modal-foot">
          <span className="bq-modal-sub">
            {incomplete.length
              ? `Finish choosing: ${incomplete.join(", ")}`
              : [
              willCore
                ? [
                    coreTypes.find((t) => t._id === value.typeId)?.type,
                    coreBrands.find((b) => b._id === value.brandId)?.name,
                    value.grade,
                  ]
                    .filter(Boolean)
                    .join(" ")
                : null,
              willInt
                ? interiorTypes.find((c) => c._id === value.intCatId)?.name
                : null,
              willExt
                ? finishes.find((f) => f._id === value.extFinishId)?.name
                : null,
            ]
              .filter(Boolean)
              .join("  +  ") || "Tick a section to apply it"}
          </span>
          <button type="button" className="bq-link" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="bq-primary"
            // Either section is enough: changing a room's board should not mean
            // restating its finishes.
            disabled={busy || !anything}
            onClick={onApply}
          >
            {busy ? "Applying…" : "Apply to all"}
          </button>
        </div>
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
            (a, it) =>
              a +
              (it.installationExcluded || it.boqExcluded
                ? 0
                : unitArea(it) * lineQty(it)),
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

  // A saved Hardware / Other Costs change, applied in place (no BOQ
  // regeneration): the unit keeps the new rows, and its calculated price (which
  // includes them, as the server builds it) moves by the change. The line adds
  // them on top of Area × Rate; the totals follow from groupedData.
  const applyExtrasSaved =
    (kind: "hardwareItems" | "otherCosts") =>
    (furnishedModelId: string, rows: any[], delta: number) =>
      setGroupedData((prev) =>
        prev.map((group) => ({
          ...group,
          items: group.items.map((it) => {
            if (it.furnishedModelId !== furnishedModelId) return it;
            const np = round2((Number(it.basePrice) || 0) + delta);
            return {
              ...it,
              [kind]: rows,
              basePrice: np,
              total_price: `₹${np}`,
              unit_price: `₹${np}`,
            };
          }),
        }))
      );
  const onHardwareSaved = applyExtrasSaved("hardwareItems");
  const onOtherCostsSaved = applyExtrasSaved("otherCosts");

  // Items total = every line still in the BOQ, quantity × rate. Derived from
  // groupedData so edits, removals and cost changes all flow into the totals.
  useEffect(() => {
    setTotalPrice(
      Number(
        groupedData.reduce((t, g) => t + groupAmount(g), 0).toFixed(2)
      )
    );
  }, [groupedData]);

  // ── Room-wise view state ────────────────────────────────────────────────
  // Rooms are open unless collapsed; forceExpand opens everything and hides
  // the action column while a PDF is captured.
  const [collapsedRooms, setCollapsedRooms] = useState<string[]>([]);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [forceExpand, setForceExpand] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    qty: string;
    rate: string;
    /** Line width / height in ft as typed; w0 / h0 = what the boxes opened with. */
    width: string;
    height: string;
    w0: string;
    h0: string;
  } | null>(null);
  // Description being added/edited in place (one line at a time).
  const [descEdit, setDescEdit] = useState<{ id: string; text: string } | null>(
    null
  );
  const [descSaving, setDescSaving] = useState<string | null>(null);

  // Which room's board is being written, so only that header shows "Applying…".
  const [coreSaving, setCoreSaving] = useState<string | null>(null);
  // Which single mesh is open for an exterior change, by component id.
  const [meshEdit, setMeshEdit] = useState<string | null>(null);
  const [meshSaving, setMeshSaving] = useState(false);
  // What each room's dialog is showing, keyed by room name. Held here rather
  // than in the dialog so a choice survives the re-render that applying causes
  // (fetchData flips isLoading, which would unmount it mid-apply).
  const [roomMat, setRoomMat] = useState<Record<string, RoomMatChoice>>({});
  // Which room's material dialog is open, by room name.
  const [roomModal, setRoomModal] = useState<string | null>(null);

  const toggleRoom = (room: string) =>
    setCollapsedRooms((prev) =>
      prev.includes(room) ? prev.filter((r) => r !== room) : [...prev, room]
    );
  const toggleItem = (id: string) => {
    if (!id) return;
    setExpandedItems((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Apply a change to the given units in place (one BOQ line = its units).
  const patchUnits = (ids: string[], patch: Partial<TableRowType>) =>
    setGroupedData((prev) =>
      prev.map((group) => ({
        ...group,
        items: group.items.map((it) =>
          ids.includes(it.furnishedModelId || "") ? { ...it, ...patch } : it
        ),
      }))
    );
  const saveUnits = async (ids: string[], patch: any) =>
    (
      await Promise.all(
        ids.map((id) => FurnishedModelsService.updateBoqLine(id, patch))
      )
    ).every(Boolean);

  // Remove a line from the BOQ (or restore it). The items stay in the design.
  const setBoqExcluded = (line: BoqLine, excluded: boolean) => {
    if (!line.ids.length) return;
    patchUnits(line.ids, { boqExcluded: excluded });
    if (editing?.id === line.id) setEditing(null);
    if (descEdit?.id === line.id) setDescEdit(null);
    saveUnits(line.ids, { boqExcluded: excluded });
  };

  // Save the edited quantity and rate. The quantity is shared evenly by the
  // line's units (4 units, Qty 6 → 1.5 each) so the line adds up to it. The
  // rate is per sq.ft on area-priced lines, per no otherwise; empty = back to
  // the calculated rate.
  // The change the edit boxes make to each unit of a line. Width is typed for
  // the whole line (e.g. 8 ft for 4 units) and kept per unit (2 ft), so a
  // later Qty change still scales it. A box left as it opened keeps the saved
  // value; an emptied Width / Height goes back to the 3D size. When the size
  // changes, the rate per sq.ft stays as shown, so the amount follows the area.
  const editPatch = (line: BoqLine, e: NonNullable<typeof editing>) => {
    const qty = Number(e.qty);
    const lineQtyNew = qty > 0 ? round2(qty) : line.units.length;
    const boqQty = Number((lineQtyNew / line.units.length).toFixed(4));
    const rateText = String(e.rate).trim();
    const rate = Number(rateText);
    let newRate: number | null =
      rateText === "" || !(rate >= 0) ? null : round2(rate);
    if (!line.bySqft) return { boqQty, boqRate: newRate };
    const patch: Partial<TableRowType> = { boqQty };
    const sizeOf = (text: string) => {
      const t = String(text).trim();
      if (t === "") return null;
      const n = Number(t);
      return n > 0 ? n : undefined; // undefined = invalid → keep as it was
    };
    let sizeChanged = false;
    if (String(e.width).trim() !== e.w0) {
      const w = sizeOf(e.width);
      if (w !== undefined) {
        patch.boqWidthFt = w === null ? null : Number((w / lineQtyNew).toFixed(4));
        sizeChanged = true;
      }
    }
    if (String(e.height).trim() !== e.h0) {
      const h = sizeOf(e.height);
      if (h !== undefined) {
        patch.boqHeightFt = h === null ? null : Number(h.toFixed(4));
        sizeChanged = true;
      }
    }
    if (sizeChanged && newRate === null) newRate = line.rate;
    patch.boqSqftRate = newRate;
    return patch;
  };

  const saveEdit = (line: BoqLine) => {
    if (!editing || !line.ids.length) return;
    const patch = editPatch(line, editing);
    patchUnits(line.ids, patch);
    setEditing(null);
    saveUnits(line.ids, patch);
  };

  // Add / update / delete a line's description (kept on each of its units).
  // An empty text deletes it; the previous text comes back if the server
  // rejects the change.
  const saveDescription = async (line: BoqLine, text: string) => {
    if (!line.ids.length) return;
    const next = text.trim();
    const prev = line.description;
    setDescEdit(null);
    if (next === prev && line.units.every((u) => (u.boqDescription || "") === next))
      return;
    patchUnits(line.ids, { boqDescription: next });
    setDescSaving(line.id);
    const ok = await saveUnits(line.ids, { boqDescription: next });
    setDescSaving((s) => (s === line.id ? null : s));
    if (!ok) {
      patchUnits(line.ids, { boqDescription: prev });
      alert("The description could not be saved. Please try again.");
    }
  };

  /**
   * Set the board and/or the inside for every item in one room.
   *
   * Confirmed first, because it overwrites a value on every part of every item
   * in the room — including anything set by hand in 3D. Both are specifications
   * rather than looks: the carcass, the back and the shelves are one sheet, and
   * the inside of a unit is one lining. A cabinet built from two different
   * boards, or lined two different ways, is not a thing anyone orders — which
   * is why these are offered at room level at all.
   *
   * ALWAYS EVERY PART, for the same reason, and with no `exposed` test: the
   * inside of a panel is lined whether or not its outside is on show.
   */
  const applyRoomCoreMaterial = async (
    room: string,
    lines: BoqLine[],
    choice: {
      core: {
        coreMaterialTypeId: string;
        coreMaterialBrandId: string;
        coreMaterialGrade: string;
      } | null;
      interior: {
        internalFinishCategoryId: string;
        internalFinishBrandId: string | null;
        internalFinishClassification: string;
      } | null;
      exterior: {
        externalFinishFinishingId: string;
        externalFinishBrandId: string | null;
        externalFinishClassification: string;
      } | null;
    }
  ) => {
    const ids = Array.from(
      new Set(
        lines
          .flatMap((l) => l.units.map((u) => u.furnishedModelId))
          .filter(Boolean) as string[]
      )
    );
    if (!ids.length) return;
    // NO CONFIRM. Pressing Apply IS the deliberate act — the controls do
    // nothing until it is pressed — so a dialog asking the same question again
    // only adds a click. The button says what it will do, and the figures
    // reprice in front of you afterwards.
    setCoreSaving(room);

    // Mirror every API write into the browser's own copy. The editor syncs that
    // copy to the server, so a change made only through the API is overwritten
    // by the stale local record and disappears on reload — with no error.
    const mirror = async (patch: Record<string, any>, partIds: string[]) => {
      if (!partIds.length) return;
      try {
        const localDB = new LocalDBManager();
        await localDB.initLocalDB();
        await localDB.patchLocalRecords(
          LocalDBObjectStores.FURNINSHED_MODEL_COMPONENT,
          patch,
          partIds
        );
      } catch (e) {
        console.error("applyRoomCoreMaterial: local mirror failed", e);
      }
    };

    let matched = 0;
    let written = 0;
    for (const id of ids) {
      if (choice.core) {
        // eslint-disable-next-line no-await-in-loop
        const r = await FurnishedModelsService.updateAllParts(id, choice.core);
        matched += r.matched;
        written += r.written;
        // eslint-disable-next-line no-await-in-loop
        await mirror(choice.core, r.writtenIds);
      }
      if (choice.interior) {
        // eslint-disable-next-line no-await-in-loop
        const r = await FurnishedModelsService.updateAllParts(id, choice.interior);
        matched += r.matched;
        written += r.written;
        // eslint-disable-next-line no-await-in-loop
        await mirror(choice.interior, r.writtenIds);
      }
      if (choice.exterior) {
        // EVERY MESH, which is what makes this the destructive one: the
        // exterior is normally a per-mesh choice and this replaces all of them,
        // including anything set in the 3D view. The dialog says so before it
        // is pressed; the per-mesh editor below is how an exception is restored.
        // eslint-disable-next-line no-await-in-loop
        const r = await FurnishedModelsService.updateAllParts(id, choice.exterior);
        matched += r.matched;
        written += r.written;
        // eslint-disable-next-line no-await-in-loop
        await mirror(choice.exterior, r.writtenIds);
      }
    }
    setCoreSaving(null);

    if (!matched) {
      alert(`No item in "${room}" has any parts recorded, so nothing changed.`);
      return;
    }
    if (written < matched) {
      alert(`Saved on ${written} of ${matched} parts. Please check the rest.`);
    }

    // REBUILD THE BILL, do not just redraw the header. Both the board and the
    // lining carry a rate, so this changes every amount and every total under
    // it — and those numbers are computed by the server from the saved parts.
    // Leaving them stale would show the new material beside the old price.
    await fetchData();
  };

  /**
   * Write an exterior finish to ONE mesh.
   *
   * The narrowest write in the BOQ: one component, one field set, every other
   * part of the item untouched.
   *
   * The browser's own copy is updated too. The editor syncs that copy to the
   * server, so a change made only through the API is overwritten by the stale
   * local record and disappears on reload — with no error anywhere.
   */
  const applyMeshFinish = async (
    componentId: string,
    choice: {
      finishingId: string;
      brandId: string | null;
      classification: string;
    }
  ) => {
    if (!componentId) return;
    setMeshSaving(true);
    const patch = {
      externalFinishFinishingId: choice.finishingId,
      externalFinishBrandId: choice.brandId,
      externalFinishClassification: choice.classification,
    };
    const ok = await FurnishedModelsService.updateOnePart(componentId, patch);
    if (ok) {
      try {
        const localDB = new LocalDBManager();
        await localDB.initLocalDB();
        await localDB.patchLocalRecords(
          LocalDBObjectStores.FURNINSHED_MODEL_COMPONENT,
          patch,
          [componentId]
        );
      } catch (e) {
        console.error("applyMeshFinish: local mirror failed", e);
      }
    }
    setMeshSaving(false);
    setMeshEdit(null);
    if (!ok) {
      alert("That finish could not be saved. Please try again.");
      return;
    }
    // The exterior carries a rate, so this item's amount and every total above
    // it move. Rebuild the bill from the server rather than relabelling the
    // row, or the new material would sit beside the old price.
    await fetchData();
  };

  const deleteDescription = (line: BoqLine) => {
    if (!line.description) return;
    if (!window.confirm("Delete this description?")) return;
    saveDescription(line, "");
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
  // When true, the BOQ renders the CLIENT format for the outgoing PDF: line items
  // still show, but the internal per-item breakdown (parts, hardware, other costs,
  // install toggle) is hidden so the PDF matches the clean quote the client sees —
  // not the elaborate editing view. Toggled only while getBoqPdfBlob rasterises.
  const [clientPdfMode, setClientPdfMode] = useState(false);
  const hideActions = clientPdfMode || forceExpand;

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
        // The BOQ is built on the server from the synced data. Send any change
        // still waiting in the browser first (a material applied a moment ago),
        // so the bill includes it. A failed sync must not block the BOQ.
        try {
          await SyncService.syncToDB();
        } catch (e) {
          console.warn("BoqTable ~ sync before BOQ failed", e);
        }
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
                // Read from the first part that carries each value: a room-level
                // apply writes the same thing to every part, so the first part
                // that has it speaks for the whole item.
                applied: (() => {
                  const comps: any[] = item.components || [];
                  const core = comps.find((c: any) => c?.coreMaterialTypeId);
                  const int = comps.find((c: any) => c?.internalFinishCategoryId);
                  /**
                   * THE OUTSIDE IS REPORTED ONLY WHEN EVERY MESH AGREES.
                   *
                   * Unlike the board and the lining, the exterior is a
                   * per-mesh choice — a shutter in oak beside a plain carcass
                   * — so "the first part that has one" would be wrong here: it
                   * would show the dialog one mesh's finish as though it were
                   * the whole unit's, and a careless Apply would then paint
                   * that over the rest. One distinct value across the meshes
                   * that carry any, or nothing.
                   */
                  const one = (field: string) => {
                    const seen = new Set(
                      comps.map((c: any) => c?.[field]).filter(Boolean)
                    );
                    return seen.size === 1 ? String(Array.from(seen)[0]) : "";
                  };
                  const extFinishId = one("externalFinishFinishingId");
                  return {
                    extFinishId,
                    // A brand only means something beside the finish it
                    // belongs to.
                    extBrandId: extFinishId ? one("externalFinishBrandId") : "",
                    typeId: core?.coreMaterialTypeId || "",
                    brandId: core?.coreMaterialBrandId || "",
                    grade: core?.coreMaterialGrade || "",
                    intCatId: int?.internalFinishCategoryId || "",
                    intBrandId: int?.internalFinishBrandId || "",
                  };
                })(),
                otherCosts: item.otherCosts || [],
                hardwareItems: item.hardwareItems || [],
                furnishedModelId: item.model?._id,
                // Installation area of one unit = its BOQ area, Width × Height
                // (the same front area the Sq.ft rate uses). Only an item with
                // no size falls back to the sum of its part areas.
                area:
                  mmToFt(item.model?.dimensions?.[1]) > 0 &&
                  mmToFt(item.model?.dimensions?.[0]) > 0
                    ? round2(
                        mmToFt(item.model?.dimensions?.[1]) *
                          mmToFt(item.model?.dimensions?.[0])
                      )
                    : round2(
                        (item.parts || []).reduce(
                          (a: number, p: any) => a + (Number(p?.area) || 0),
                          0
                        )
                      ),
                installationExcluded: !!item.installationExcluded,
                basePrice: Number(item.model?.price) || 0,
                boqQty: Number(item.boqQty) > 0 ? Number(item.boqQty) : 1,
                boqRate:
                  item.boqRate === null || item.boqRate === undefined
                    ? null
                    : Number(item.boqRate),
                boqExcluded: !!item.boqExcluded,
                boqDescription:
                  typeof item.boqDescription === "string"
                    ? item.boqDescription
                    : "",
                boqSqftRate:
                  item.boqSqftRate === null || item.boqSqftRate === undefined
                    ? null
                    : Number(item.boqSqftRate),
                categoryName: item.categoryName || "",
                boqWidthFt:
                  Number(item.boqWidthFt) > 0 ? Number(item.boqWidthFt) : null,
                boqHeightFt:
                  Number(item.boqHeightFt) > 0 ? Number(item.boqHeightFt) : null,
                heightMm: Number(item.model?.dimensions?.[0]) || 0,
                widthMm: Number(item.model?.dimensions?.[1]) || 0,
                unit: "Nos",
                // "Type · Brand" of the chosen finishes, e.g. "Laminates ·
                // Greenlam" — built on the server (generate_boq finishLabels).
                material: (item.finishLabels || []).join("; "),
                dims: dimsInFeet(item.model?.dimensions),
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

          // The items total (quantity × rate of every line still in the BOQ)
          // follows from groupedData — see the effect next to applyExtrasSaved.
          setGroupedData(groupedByRoom);
          setRowsTable(formattedRows);
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
      setForceExpand(true);
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
      setForceExpand(false);
    }
  }, [targetRef]);

  useEffect(() => {
    registerPdfGetter?.(getBoqPdfBlob);
  }, [registerPdfGetter, getBoqPdfBlob]);

  const handleExportAsPDF = async () => {
    // Every room open and no edit buttons in the PDF; back to normal right after
    // the page is captured.
    setEditing(null);
    setForceExpand(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pdfOptions: any = {
      resolution: Resolution.MEDIUM,
      page: { margin: Margin.SMALL, format: "letter" },
      canvas: { mimeType: "image/jpeg", qualityRatio: 0.98 },
      overrides: { pdf: { compress: false }, canvas: { useCORS: true } },
    };
    // Build the PDF (don't just open it) so we can BOTH download it for the user
    // AND archive it into the project Workspace as a "Quote" document.
    let pdf: any;
    try {
      pdf = await generatePDF(targetRef, {
        ...pdfOptions,
        method: "build",
      });
    } finally {
      setForceExpand(false);
    }
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

            <div className="bq-rooms">
              {(() => {
                let serial = 0;
                const colCount = hideActions ? 11 : 12;
                return groupedData.map((group, index) => {
                  const allLines = buildLines(group.items);
                  const lines = allLines.filter((l) => !l.excluded);
                  const removed = allLines.filter((l) => l.excluded);
                  const roomArea = round2(
                    lines.reduce((a, l) => a + (l.bySqft ? l.area : 0), 0)
                  );
                  const open =
                    forceExpand || !collapsedRooms.includes(group.room);
                  const RoomIcon = roomIconFor(group.room);
                  // What the room is already made of is read by the dialog
                  // itself — appliedMatFor, beside blankRoomMat.
                  return (
                    <div className="bq-room" key={index}>
                      <div
                        className="bq-room-head"
                        onClick={() => toggleRoom(group.room)}
                      >
                        <div className="bq-room-title">
                          <span className="bq-room-icon">
                            <RoomIcon style={{ fontSize: 18 }} />
                          </span>
                          <span>{group.room || "Room"}</span>
                        </div>
                        {/* ONE BUTTON, NOT SIX DROPDOWNS.
                            The board, the lining and the outside finish each
                            have their own cascade, and strung across the header
                            they left no width for the room's figures — nor any
                            for the exterior at all. They open in a dialog now.
                            The click guard stops the header collapsing the room
                            when the button is pressed. */}
                        {hideActions ? null : (
                          <button
                            type="button"
                            className="bq-room-mat"
                            disabled={coreSaving === group.room}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRoomModal(group.room);
                            }}
                          >
                            {coreSaving === group.room
                              ? "Applying…"
                              : "Material configuration"}
                          </button>
                        )}
                        <div className="bq-room-stats">
                          {forceExpand ? null : open ? (
                            <KeyboardArrowUpIcon style={{ fontSize: 18 }} />
                          ) : (
                            <KeyboardArrowDownIcon style={{ fontSize: 18 }} />
                          )}
                        </div>
                      </div>
                      {/* The room's figures, under the controls rather than
                          beside them — see the note above. */}
                      <div className="bq-room-figs">
                        <span>Items: {lines.length}</span>
                        <span className="bq-sep">|</span>
                        <span>
                          Qty:{" "}
                          {formatQty(
                            round2(lines.reduce((q, l) => q + l.qty, 0))
                          )}
                        </span>
                        {roomArea > 0 ? (
                          <>
                            <span className="bq-sep">|</span>
                            <span>Area: {plain(roomArea)} sq.ft</span>
                          </>
                        ) : null}
                        <span className="bq-figs-amt">
                          Amount: <b>{money(groupAmount(group))}</b>
                        </span>
                      </div>
                      {open ? (
                        <table className="bq-table">
                          <thead>
                            <tr>
                              <th style={{ width: "4%" }}>S.No</th>
                              <th style={{ width: "15%" }}>Item</th>
                              <th style={{ width: "14%" }}>Description</th>
                              <th style={{ width: "11%" }}>Material</th>
                              <th className="r" style={{ width: "5%" }}>Qty</th>
                              <th style={{ width: "5%" }}>Unit</th>
                              <th className="r" style={{ width: "8%" }}>Width (ft)</th>
                              <th className="r" style={{ width: "7%" }}>Height (ft)</th>
                              <th className="r" style={{ width: "7%" }}>Area (Sq.ft)</th>
                              <th className="r" style={{ width: "8%" }}>Rate / Sq.ft (₹)</th>
                              <th className="r" style={{ width: "9%" }}>Amount (₹)</th>
                              {hideActions ? null : (
                                <th className="c" style={{ width: "7%" }}>Action</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((line) => {
                              serial += 1;
                              const item = line.lead;
                              const id = line.id;
                              const isEditing = editing?.id === id;
                              // While editing, Width × Height → Area → Amount
                              // follow the boxes as they are typed.
                              const shown =
                                isEditing && editing
                                  ? lineFromUnits(
                                      line.units.map((u) => ({
                                        ...u,
                                        ...editPatch(line, editing),
                                      }))
                                    )
                                  : line;
                              const isDescEditing = descEdit?.id === id;
                              const isOpen =
                                !clientPdfMode && expandedItems.includes(id);
                              // Installation, hardware and other costs per unit
                              // (the per-part cost table is not shown).
                              const hasDetails = line.ids.length > 0;
                              return (
                                <React.Fragment key={id || serial}>
                                  <tr
                                    className={
                                      "bq-line" + (isOpen ? " open" : "")
                                    }
                                    onClick={() =>
                                      !clientPdfMode &&
                                      !isEditing &&
                                      !isDescEditing &&
                                      toggleItem(id)
                                    }
                                  >
                                    <td>{serial}</td>
                                    <td>
                                      <div className="bq-item">
                                        {item.thumbnail ? (
                                          <img
                                            className="bq-thumb"
                                            src={item.thumbnail}
                                            alt=""
                                            onError={(e) => {
                                              (
                                                e.currentTarget as HTMLImageElement
                                              ).style.visibility = "hidden";
                                            }}
                                          />
                                        ) : (
                                          <span className="bq-thumb" />
                                        )}
                                        <div>
                                          <div className="bq-item-name">
                                            {item.item_name}
                                          </div>
                                          {line.unitWidth > 0 && line.height > 0 ? (
                                            <div className="bq-sub">
                                              {line.bySqft ? "Each unit: " : "Size: "}
                                              {line.unitWidth} ft (W) × {line.height} ft (H)
                                            </div>
                                          ) : null}
                                          {/* The "default material on N panel(s)" note is
                                              not shown. Only a missing rate (a part
                                              priced ₹0) is flagged, on screen only. */}
                                          {item.flag?.startsWith("⚠") && !hideActions ? (
                                            <div className="bq-flag warn">
                                              {item.flag}
                                            </div>
                                          ) : null}
                                        </div>
                                      </div>
                                    </td>
                                    <td
                                      className="bq-desc"
                                      onClick={(e) =>
                                        !hideActions && e.stopPropagation()
                                      }
                                    >
                                      {isDescEditing && !hideActions ? (
                                        <div className="bq-desc-edit">
                                          <textarea
                                            className="bq-textarea"
                                            rows={3}
                                            maxLength={2000}
                                            autoFocus
                                            placeholder="e.g. 18mm BWP plywood carcass, soft-close hinges"
                                            aria-label={`Description for ${item.item_name}`}
                                            value={descEdit.text}
                                            onChange={(e) =>
                                              setDescEdit({
                                                id,
                                                text: e.target.value,
                                              })
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === "Escape") {
                                                setDescEdit(null);
                                              } else if (
                                                e.key === "Enter" &&
                                                (e.ctrlKey || e.metaKey)
                                              ) {
                                                e.preventDefault();
                                                saveDescription(line, descEdit.text);
                                              }
                                            }}
                                          />
                                          <span className="bq-desc-btns">
                                            <button
                                              type="button"
                                              className="bq-btn primary"
                                              onClick={() =>
                                                saveDescription(line, descEdit.text)
                                              }
                                            >
                                              Save
                                            </button>
                                            <button
                                              type="button"
                                              className="bq-btn"
                                              onClick={() => setDescEdit(null)}
                                            >
                                              Cancel
                                            </button>
                                          </span>
                                        </div>
                                      ) : line.description ? (
                                        <div className="bq-desc-view">
                                          <span className="bq-desc-text">
                                            {line.description}
                                          </span>
                                          {hideActions ? null : (
                                            <span className="bq-actions bq-desc-actions">
                                              <button
                                                type="button"
                                                title="Edit description"
                                                aria-label="Edit description"
                                                disabled={descSaving === id}
                                                onClick={() =>
                                                  setDescEdit({
                                                    id,
                                                    text: line.description,
                                                  })
                                                }
                                              >
                                                <EditOutlined style={{ fontSize: 14 }} />
                                              </button>
                                              <button
                                                type="button"
                                                title="Delete description"
                                                aria-label="Delete description"
                                                disabled={descSaving === id}
                                                onClick={() => deleteDescription(line)}
                                              >
                                                <DeleteOutline style={{ fontSize: 14 }} />
                                              </button>
                                            </span>
                                          )}
                                        </div>
                                      ) : hideActions ? (
                                        "—"
                                      ) : (
                                        <button
                                          type="button"
                                          className="bq-link bq-add-desc"
                                          onClick={() => setDescEdit({ id, text: "" })}
                                        >
                                          + Add description
                                        </button>
                                      )}
                                    </td>
                                    {/* MATERIAL — shown as chips, changed in place.
                                        `item.material` arrives from the server as
                                        "Type · Brand" strings, one per finish type on the
                                        item. Split for display so each part of it reads as
                                        the separate field it is. */}
                                    <td
                                      className="bq-mat"
                                      onClick={(e) =>
                                        !hideActions && e.stopPropagation()
                                      }
                                    >
                                      {/* THE CELL ONLY EVER SHOWS. The editor
                                          opens as its own full-width row below
                                          — this column is 11% of the table, and
                                          three dropdowns plus two buttons
                                          squeezed into it spilled over Qty and
                                          broke "Cancel" and "Apply" one letter
                                          to a line. */}
                                      <span className="bq-mat-view">
                                        {item.material ? (
                                          item.material
                                            .split(";")
                                            .map((part, pi) => {
                                              // "Core: Plywood · Century · BWP"
                                              // The side is set apart from the
                                              // material it labels, so three
                                              // chips on one row are told apart
                                              // at a glance instead of being
                                              // read word by word — and each
                                              // gets its own colour, because
                                              // "which one is the board" is the
                                              // first question anyone asks of
                                              // this column.
                                              const txt = part.trim();
                                              const at = txt.indexOf(": ");
                                              const side =
                                                at > 0 ? txt.slice(0, at) : "";
                                              const rest =
                                                at > 0 ? txt.slice(at + 2) : txt;
                                              return (
                                                <span
                                                  className={`bq-chip${
                                                    side
                                                      ? ` bq-chip-${side.toLowerCase()}`
                                                      : ""
                                                  }`}
                                                  key={pi}
                                                  title={txt}
                                                >
                                                  {side ? (
                                                    <b className="bq-chip-side">
                                                      {side}
                                                    </b>
                                                  ) : null}
                                                  {rest}
                                                </span>
                                              );
                                            })
                                        ) : (
                                          <span className="bq-muted">—</span>
                                        )}
                                        {/* NO PER-ITEM EDIT HERE.
                                            The exterior is a decision per MESH —
                                            a shutter in oak, a side panel
                                            laminated only where it is seen — and
                                            an item-level control could only
                                            write one finish to every part at
                                            once, flattening that in a single
                                            press. The core and the interior are
                                            whole-unit choices and belong in the
                                            room header; the exterior is changed
                                            per mesh in the expanded row below.
                                            This column REPORTS what the item
                                            carries; nothing is edited from it. */}
                                      </span>
                                    </td>
                                    <td className="r">
                                      {isEditing ? (
                                        <input
                                          className="bq-input"
                                          type="number"
                                          min="0.01"
                                          step="1"
                                          aria-label="Quantity"
                                          value={editing.qty}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) =>
                                            setEditing({ ...editing, qty: e.target.value })
                                          }
                                        />
                                      ) : (
                                        formatQty(line.qty)
                                      )}
                                    </td>
                                    <td>{line.bySqft ? "Sq.ft" : "Nos"}</td>
                                    <td className="r">
                                      {!line.bySqft ? (
                                        "—"
                                      ) : isEditing ? (
                                        <input
                                          className="bq-input"
                                          type="number"
                                          min="0.01"
                                          step="0.01"
                                          aria-label="Width in feet"
                                          title="Width of the whole line in ft. Empty = the 3D size."
                                          placeholder={String(round2(mmToFt(item.widthMm) * shown.qty))}
                                          value={editing.width}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) =>
                                            setEditing({ ...editing, width: e.target.value })
                                          }
                                        />
                                      ) : (
                                        <>
                                          {plain(line.overallWidth)}
                                          {line.qty !== 1 ? (
                                            <div className="bq-sub">
                                              {line.unitWidth} × {formatQty(line.qty)}
                                            </div>
                                          ) : null}
                                        </>
                                      )}
                                    </td>
                                    <td className="r">
                                      {!line.bySqft ? (
                                        "—"
                                      ) : isEditing ? (
                                        <input
                                          className="bq-input"
                                          type="number"
                                          min="0.01"
                                          step="0.01"
                                          aria-label="Height in feet"
                                          title="Height in ft. Empty = the 3D size."
                                          placeholder={String(mmToFt(item.heightMm))}
                                          value={editing.height}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) =>
                                            setEditing({ ...editing, height: e.target.value })
                                          }
                                        />
                                      ) : (
                                        plain(line.height)
                                      )}
                                    </td>
                                    <td className="r">
                                      {shown.bySqft ? (
                                        <b className="bq-area">{plain(shown.area)}</b>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                    <td className="r">
                                      {isEditing ? (
                                        <input
                                          className="bq-input"
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          aria-label={
                                            line.bySqft ? "Rate per sq.ft" : "Rate per no"
                                          }
                                          placeholder={String(line.rate || 0)}
                                          value={editing.rate}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) =>
                                            setEditing({ ...editing, rate: e.target.value })
                                          }
                                        />
                                      ) : (
                                        <>
                                          {plain(line.rate)}
                                          <div className="bq-sub">
                                            {line.bySqft ? "per sq.ft" : "per no"}
                                          </div>
                                        </>
                                      )}
                                    </td>
                                    <td className="r bq-amount">
                                      {plain(shown.amount)}
                                      {shown.extras > 0 ? (
                                        <div className="bq-sub">
                                          incl. ₹{plain(shown.extras)} hardware / other
                                        </div>
                                      ) : null}
                                    </td>
                                    {hideActions ? null : (
                                      <td className="c">
                                        {isEditing ? (
                                          <span className="bq-actions">
                                            <button
                                              type="button"
                                              title="Save"
                                              aria-label="Save"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                saveEdit(line);
                                              }}
                                            >
                                              <CheckOutlined style={{ fontSize: 16 }} />
                                            </button>
                                            <button
                                              type="button"
                                              title="Cancel"
                                              aria-label="Cancel"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setEditing(null);
                                              }}
                                            >
                                              <CloseOutlined style={{ fontSize: 16 }} />
                                            </button>
                                          </span>
                                        ) : (
                                          <span className="bq-actions">
                                            <button
                                              type="button"
                                              title={
                                                line.bySqft
                                                  ? "Edit quantity, width, height and rate per sq.ft"
                                                  : "Edit quantity and rate"
                                              }
                                              aria-label="Edit quantity and rate"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const w0 = line.bySqft
                                                  ? String(line.overallWidth)
                                                  : "";
                                                const h0 = line.bySqft
                                                  ? String(line.height)
                                                  : "";
                                                setEditing({
                                                  id,
                                                  qty: String(line.qty),
                                                  rate: line.rateEdited
                                                    ? String(line.rate)
                                                    : "",
                                                  width: w0,
                                                  height: h0,
                                                  w0,
                                                  h0,
                                                });
                                              }}
                                            >
                                              <EditOutlined style={{ fontSize: 16 }} />
                                            </button>
                                            <button
                                              type="button"
                                              title="Remove from BOQ"
                                              aria-label="Remove from BOQ"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setBoqExcluded(line, true);
                                              }}
                                            >
                                              <DeleteOutline style={{ fontSize: 16 }} />
                                            </button>
                                          </span>
                                        )}
                                      </td>
                                    )}
                                  </tr>
                                  {isOpen && hasDetails ? (
                                    <tr className="bq-detail">
                                      <td colSpan={colCount}>
                                        {line.units.map((unit, ui) => (
                                          <div
                                            key={unit.furnishedModelId || ui}
                                            className="bq-unit"
                                          >
                                            {line.units.length > 1 ? (
                                              <div className="bq-unit-head">
                                                Unit {ui + 1} of {line.units.length}
                                              </div>
                                            ) : null}

                                            {/* THE MESHES THIS UNIT IS MADE OF.
                                                Exterior only. Core and interior
                                                are one choice for the whole unit,
                                                made in the room header above —
                                                a cabinet is not built from two
                                                different boards, nor lined two
                                                different ways.
                                                The AREA is how you tell the
                                                panels apart: the mesh names come
                                                from the 3D file and say nothing,
                                                so the 5.28 sq.ft row is the
                                                shutter and the 0.03 sq.ft one is
                                                a handle rail. */}
                                            {(unit.parts || []).filter(
                                              (pt: any) => pt && !pt.isHardware
                                            ).length ? (
                                              <table className="bq-mesh-tbl">
                                                <thead>
                                                  <tr>
                                                    <th>Part</th>
                                                    <th className="r">Area</th>
                                                    <th>Exterior finish</th>
                                                    <th className="r">Exterior</th>
                                                    <th />
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {(unit.parts || [])
                                                    .filter(
                                                      (pt: any) => pt && !pt.isHardware
                                                    )
                                                    .map((pt: any, pi: number) => (
                                                      <React.Fragment
                                                        key={pt._id || pi}
                                                      >
                                                        <tr>
                                                          <td>{pt.name}</td>
                                                          <td className="r">
                                                            {plain(pt.area)} sq.ft
                                                          </td>
                                                          <td>
                                                            {pt.exteriorRate ? (
                                                              `${money(
                                                                pt.exteriorRate
                                                              )} / sq.ft`
                                                            ) : (
                                                              <span className="bq-muted">
                                                                not finished
                                                              </span>
                                                            )}
                                                          </td>
                                                          <td className="r">
                                                            {pt.exteriorCost
                                                              ? money(pt.exteriorCost)
                                                              : "-"}
                                                          </td>
                                                          <td className="r">
                                                            {/* No id means the
                                                                row can be shown
                                                                but not changed —
                                                                offering Edit
                                                                would be a button
                                                                that cannot work. */}
                                                            {hideActions ||
                                                            !pt._id ? null : (
                                                              <button
                                                                type="button"
                                                                className="bq-link"
                                                                onClick={() =>
                                                                  setMeshEdit(
                                                                    meshEdit === pt._id
                                                                      ? null
                                                                      : pt._id
                                                                  )
                                                                }
                                                              >
                                                                {meshEdit === pt._id
                                                                  ? "Close"
                                                                  : "Edit"}
                                                              </button>
                                                            )}
                                                          </td>
                                                        </tr>
                                                        {meshEdit === pt._id ? (
                                                          <tr>
                                                            <td colSpan={5}>
                                                              <MeshFinishPicker
                                                                label={`${
                                                                  pt.name
                                                                } - ${plain(
                                                                  pt.area
                                                                )} sq.ft`}
                                                                busy={meshSaving}
                                                                currentFinishingId={
                                                                  pt.externalFinishFinishingId
                                                                }
                                                                currentBrandId={
                                                                  pt.externalFinishBrandId
                                                                }
                                                                onCancel={() =>
                                                                  setMeshEdit(null)
                                                                }
                                                                onApply={(choice) => {
                                                                  void applyMeshFinish(
                                                                    pt._id,
                                                                    choice
                                                                  );
                                                                }}
                                                              />
                                                            </td>
                                                          </tr>
                                                        ) : null}
                                                      </React.Fragment>
                                                    ))}
                                                </tbody>
                                              </table>
                                            ) : null}
                                            <div className="bq-install">
                                              <input
                                                type="checkbox"
                                                checked={!unit.installationExcluded}
                                                onChange={() =>
                                                  toggleInstallation(
                                                    unit.furnishedModelId,
                                                    unit.installationExcluded
                                                  )
                                                }
                                              />
                                              <span className="bq-install-label">
                                                Installation
                                              </span>
                                              <span
                                                style={{
                                                  color: unit.installationExcluded
                                                    ? "#9ca3af"
                                                    : "#111827",
                                                }}
                                              >
                                                {unit.installationExcluded
                                                  ? "excluded"
                                                  : `${plain(unitArea(unit))} ft² × ${formatQty(
                                                      lineQty(unit)
                                                    )} @ ₹${installationRate}/ft² = ${rupee(
                                                      unitArea(unit) *
                                                        lineQty(unit) *
                                                        installationRate
                                                    )}`}
                                              </span>
                                            </div>
                                            <HardwareEditor
                                              furnishedModelId={unit.furnishedModelId}
                                              initialRows={unit.hardwareItems || []}
                                              master={hardwareMaster}
                                              onSaved={onHardwareSaved}
                                            />
                                            <OtherCostsEditor
                                              furnishedModelId={unit.furnishedModelId}
                                              initialRows={unit.otherCosts || []}
                                              onSaved={onOtherCostsSaved}
                                            />
                                          </div>
                                        ))}
                                      </td>
                                    </tr>
                                  ) : null}
                                </React.Fragment>
                              );
                            })}
                            {!hideActions && removed.length ? (
                              <tr className="bq-removed">
                                <td colSpan={colCount}>
                                  Removed from BOQ:{" "}
                                  {removed.map((l, i) => (
                                    <span key={l.id || i}>
                                      {i > 0 ? " · " : ""}
                                      {l.lead.item_name}
                                      {l.qty !== 1 ? ` × ${formatQty(l.qty)}` : ""}{" "}
                                      <button
                                        type="button"
                                        className="bq-link"
                                        onClick={() => setBoqExcluded(l, false)}
                                      >
                                        <RestoreOutlined style={{ fontSize: 14 }} /> Restore
                                      </button>
                                    </span>
                                  ))}
                                </td>
                              </tr>
                            ) : null}
                            <tr className="bq-room-total">
                              <td colSpan={8}>{group.room || "Room"} Total</td>
                              <td className="r">
                                {roomArea > 0 ? plain(roomArea) : ""}
                              </td>
                              <td />
                              <td className="r">{money(groupAmount(group))}</td>
                              {hideActions ? null : <td />}
                            </tr>
                          </tbody>
                        </table>
                      ) : null}
                    </div>
                  );
                });
              })()}
            </div>
            {/* Mounted once, outside the room loop: a dialog belongs to the
                page, not to a row that may re-render under it mid-choice. */}
            {roomModal
              ? (() => {
                  const g = groupedData.find((x) => x.room === roomModal);
                  const roomLines = g
                    ? buildLines(g.items).filter((l) => !l.excluded)
                    : [];
                  // The room's own material until someone touches a field;
                  // their choice then takes over for as long as it is open.
                  const value = roomMat[roomModal] || appliedMatFor(roomLines);
                  return (
                    <RoomMaterialModal
                      room={roomModal}
                      items={roomLines.length}
                      busy={coreSaving === roomModal}
                      value={value}
                      onChange={(next) =>
                        setRoomMat((prev) => ({ ...prev, [roomModal]: next }))
                      }
                      onCancel={() => setRoomModal(null)}
                      onApply={() => {
                        void applyRoomCoreMaterial(roomModal, roomLines, {
                          // Each section is written only when it is TICKED and
                          // filled in. An unticked section is sent as null and
                          // applyRoomCoreMaterial skips it entirely — no write,
                          // not even of the values it already has.
                          core:
                            value.applyCore && value.typeId && value.brandId
                              ? {
                                  coreMaterialTypeId: value.typeId,
                                  coreMaterialBrandId: value.brandId,
                                  coreMaterialGrade: value.grade,
                                }
                              : null,
                          interior: value.applyInt && value.intCatId
                            ? {
                                internalFinishCategoryId: value.intCatId,
                                // "" would be stored as an empty string and
                                // never match a rate lookup; null means "any
                                // brand", which is a real rate row.
                                internalFinishBrandId: value.intBrandId || null,
                                internalFinishClassification: "",
                              }
                            : null,
                          exterior: value.applyExt && value.extFinishId
                            ? {
                                externalFinishFinishingId: value.extFinishId,
                                externalFinishBrandId: value.extBrandId || null,
                                externalFinishClassification: "",
                              }
                            : null,
                        }).then(() => {
                          // Forget this room's draft, ticks included. Kept, it
                          // would reopen with the same sections already
                          // ticked, and the next "Apply to all" would rewrite
                          // them without anyone having chosen to. It reopens
                          // from what the room actually has, unticked.
                          setRoomMat((prev) => {
                            const next = { ...prev };
                            delete next[roomModal];
                            return next;
                          });
                          setRoomModal(null);
                        });
                      }}
                    />
                  );
                })()
              : null}
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
