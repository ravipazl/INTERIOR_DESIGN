import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Container,
  Form,
  Row,
  Spinner,
  Table,
  Tab,
  Tabs,
} from "react-bootstrap";
import { getCurrentUser } from "../../services/authService";
import { USER_ROLES } from "../../utils/constants";
import NavRail from "@pazl/components/NavRail";
import {
  getCoreMaterialTypes,
  getCoreMaterialBrands,
  getFinishingCategories,
  getFinishingBrands,
  listMaterialRates,
  createMaterialRate,
  updateMaterialRate,
  removeMaterialRate,
  listCoatingRates,
  createCoatingRate,
  updateCoatingRate,
  removeCoatingRate,
  listInteriorRates,
  createInteriorRate,
  updateInteriorRate,
  removeInteriorRate,
  listHardware,
  createHardware,
  updateHardware,
  removeHardware,
  getInstallationRate,
  setInstallationRate as saveInstallationRate,
} from "../../services/ratesService";
import ManageLists from "./ManageLists";

/**
 * Rate Card (Masters) — admin screen to maintain BOQ pricing.
 *
 * MOVED here from the design app (:3031). The data still lives in the DESIGN
 * backend — these are the SAME collections the 3D editor's material/coating
 * pickers read, so a rate added here shows up in the 3D picker AND prices the
 * BOQ. Only the screen moved; no backend or 3D-editor behaviour changed.
 *
 * Four tabs: Material rates (type + grade + brand), Coating rates
 * (finish type + grade + brand), Hardware, and a single global Installation
 * rate. Admin / super-admin only.
 *
 * COATING IS PICKED THE SAME WAY AS MATERIAL. A finish category is already a
 * two-level tree — Laminates > Wood Grain, Paint Finishes > PU Finish — but the
 * form offered one flat dropdown of every child, so "Wood Grain" and "PU
 * Finish" sat side by side with nothing saying which family each belonged to.
 * Splitting it into Finish type > Grade narrows the second list to the chosen
 * family, exactly as Grade narrows to the chosen material above.
 *
 * The STORED rate is unchanged: `finishingCategoryId` still holds the child,
 * and the finish type is read back from that child's `parentCategoryId`. No
 * migration, and the 3D editor keeps reading these rows as before.
 */

const blankMaterial = {
  coreMaterialTypeId: "",
  grade: "",
  brandId: "",
  pricePerSqft: 0,
};
const blankCoating = {
  // UI only — it narrows the Grade dropdown and is NOT part of the stored rate.
  // `finishingpricing` sets additionalProperties:false, so saveCoating strips
  // it; sending it is a 400.
  finishingTypeId: "",
  finishingCategoryId: "",
  finishingBrandId: "",
  pricePerSqft: 0,
};
// The INSIDE of a carcass — inner lamination, priced from its own table. Same
// three fields as a coating rate, because it names the same catalogue; only the
// price is separate. See interior_pricing.class.js on the server.
const blankInterior = {
  finishingTypeId: "",
  finishingCategoryId: "",
  finishingBrandId: "",
  pricePerSqft: 0,
};

const RateCard = () => {
  const user = getCurrentUser();
  const isAdmin =
    user?.permissions === USER_ROLES.ADMIN ||
    user?.permissions === USER_ROLES.SUPER_ADMIN;

  const [tab, setTab] = useState("material");
  // The catalogue drawer — closed by default, because the common job on this
  // page is pricing a combination that already exists, not inventing one.
  const [showLists, setShowLists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);

  // catalog (dropdown sources)
  const [materialTypes, setMaterialTypes] = useState([]);
  const [coreBrands, setCoreBrands] = useState([]);
  const [finishCategories, setFinishCategories] = useState([]);
  const [finishBrands, setFinishBrands] = useState([]);

  // rate rows
  const [materialRates, setMaterialRates] = useState([]);
  const [coatingRates, setCoatingRates] = useState([]);
  const [interiorRates, setInteriorRates] = useState([]);
  const [hardware, setHardware] = useState([]);
  const [installationRate, setInstallationRateState] = useState("");

  // drafts
  const [matDraft, setMatDraft] = useState(blankMaterial);
  const [coatDraft, setCoatDraft] = useState(blankCoating);
  const [intDraft, setIntDraft] = useState(blankInterior);
  const [hwDraft, setHwDraft] = useState({ name: "", price: "" });

  // Installation is a single global number, so it uses an explicit Edit/Save
  // rather than a silent auto-save.
  const [installEditing, setInstallEditing] = useState(false);
  const [installSaved, setInstallSaved] = useState(false);
  const [installError, setInstallError] = useState("");

  useEffect(() => {
    if (isAdmin) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async () => {
    setLoading(true);
    const [types, cBrands, cats, fBrands, mRates, cRates, iRates, hw] =
      await Promise.all([
        getCoreMaterialTypes(),
        getCoreMaterialBrands(),
        getFinishingCategories(),
        getFinishingBrands(),
        listMaterialRates(),
        listCoatingRates(),
        listInteriorRates(),
        listHardware(),
      ]);
    getInstallationRate().then((r) => setInstallationRateState(r || ""));
    setMaterialTypes(types);
    setCoreBrands(cBrands);
    setFinishCategories(cats);
    setFinishBrands(fBrands);
    setMaterialRates(mRates);
    setCoatingRates(cRates);
    setInteriorRates(iRates);
    setHardware(hw);
    setLoading(false);
  };

  // id -> readable name lookups
  const nameOf = (list, id) => list.find((x) => x._id === id)?.name ?? id ?? "—";
  // core_material_types use `type` (not `name`) as the display field
  const typeName = (id) =>
    materialTypes.find((x) => x._id === id)?.type ?? id ?? "—";
  const coreBrandName = (id) => nameOf(coreBrands, id);
  const catName = (id) => nameOf(finishCategories, id);
  const finBrandName = (id) => nameOf(finishBrands, id);

  const gradesForType = useMemo(() => {
    const t = materialTypes.find((x) => x._id === matDraft.coreMaterialTypeId);
    return t?.grades ?? [];
  }, [materialTypes, matDraft.coreMaterialTypeId]);

  // A finish category with no parent IS a finish type; its children are the
  // grades sold under it. One collection, read two ways.
  const finishTypes = useMemo(
    () => finishCategories.filter((c) => !c.parentCategoryId),
    [finishCategories]
  );
  const finishGradesForType = useMemo(
    () =>
      finishCategories.filter(
        (c) => c.parentCategoryId && c.parentCategoryId === coatDraft.finishingTypeId
      ),
    [finishCategories, coatDraft.finishingTypeId]
  );
  /**
   * INTERIOR IS LAMINATE, AND ONLY LAMINATE.
   *
   * The inside of a carcass is lined with inner lamination. It is never
   * painted and never glass, so offering Paint Finishes and Glass Finishes
   * here would be three choices where only one is real — and two of them would
   * price a surface that does not exist.
   *
   * Matched on the name rather than an id so a type added later ("Inner
   * lamination") is picked up without a code change. If nothing matches, every
   * type is offered rather than leaving the screen with an empty dropdown.
   */
  const interiorTypes = useMemo(() => {
    const lam = finishTypes.filter((c) => /lamina/i.test(c.name || ""));
    return lam.length ? lam : finishTypes;
  }, [finishTypes]);
  // A stored rate names only the grade, so the type is read back from it.
  const typeIdOfGrade = (gradeId) =>
    finishCategories.find((c) => c._id === gradeId)?.parentCategoryId ?? "";
  const finishTypeNameOfGrade = (gradeId) => {
    const parentId = typeIdOfGrade(gradeId);
    return parentId ? nameOf(finishCategories, parentId) : "—";
  };

  const cancelEdit = () => {
    setEditId(null);
    setMatDraft(blankMaterial);
    setCoatDraft(blankCoating);
    setIntDraft(blankInterior);
    setHwDraft({ name: "", price: "" });
  };

  // ---- material rate actions ----
  const saveMaterial = async () => {
    if (
      !matDraft.coreMaterialTypeId ||
      !matDraft.brandId ||
      !matDraft.pricePerSqft
    ) {
      alert("Pick a material, a brand, and enter a rate.");
      return;
    }
    setSaving(true);
    const payload = { ...matDraft, pricePerSqft: Number(matDraft.pricePerSqft) };
    if (editId) await updateMaterialRate(editId, payload);
    else await createMaterialRate(payload);
    setMatDraft(blankMaterial);
    setEditId(null);
    setSaving(false);
    loadAll();
  };

  const editMaterial = (row) => {
    setEditId(row._id);
    setMatDraft({
      coreMaterialTypeId: row.coreMaterialTypeId,
      grade: row.grade,
      brandId: row.brandId,
      thickness: row.thickness,
      pricePerSqft: row.pricePerSqft,
    });
  };

  const deleteMaterial = async (id) => {
    if (!window.confirm("Delete this material rate?")) return;
    await removeMaterialRate(id);
    loadAll();
  };

  // ---- coating rate actions ----
  const saveCoating = async () => {
    if (
      !coatDraft.finishingCategoryId ||
      !coatDraft.finishingBrandId ||
      !coatDraft.pricePerSqft
    ) {
      alert("Pick a finish type and grade, a brand, and enter a rate.");
      return;
    }
    setSaving(true);
    // `finishingTypeId` is a UI field only — the grade already identifies its
    // type. finishingpricing refuses unknown properties, so it is dropped here
    // rather than spread into the payload.
    const { finishingTypeId, ...stored } = coatDraft;
    const payload = {
      ...stored,
      pricePerSqft: Number(coatDraft.pricePerSqft),
    };
    if (editId) await updateCoatingRate(editId, payload);
    else await createCoatingRate(payload);
    setCoatDraft(blankCoating);
    setEditId(null);
    setSaving(false);
    loadAll();
  };

  const editCoating = (row) => {
    setEditId(row._id);
    setCoatDraft({
      // Re-derived so the Grade dropdown opens on the right family.
      finishingTypeId: typeIdOfGrade(row.finishingCategoryId),
      finishingCategoryId: row.finishingCategoryId,
      finishingBrandId: row.finishingBrandId,
      pricePerSqft: row.pricePerSqft,
    });
  };

  const deleteCoating = async (id) => {
    if (!window.confirm("Delete this coating rate?")) return;
    await removeCoatingRate(id);
    loadAll();
  };

  // ---- interior rate actions ----
  //
  // The inside of a carcass. Same three catalogue fields as a coating rate, and
  // the same `finishingTypeId` that exists only to narrow the Grade list and is
  // stripped before saving.
  //
  // The BRAND IS OPTIONAL here, unlike a coating rate: inner lamination is
  // routinely quoted without naming one, and a rate saved with no brand is the
  // fallback the BOQ uses when a part names a brand nothing is priced for.
  const saveInterior = async () => {
    if (!intDraft.finishingCategoryId || !intDraft.pricePerSqft) {
      alert("Pick a finish type and enter a rate.");
      return;
    }
    setSaving(true);
    // `finishingCategoryId` holds the TYPE here, not a grade — there is no
    // grade on an interior rate. `finishingTypeId` is a leftover of the shared
    // draft shape and is never sent.
    const { finishingTypeId, ...stored } = intDraft;
    const payload = {
      ...stored,
      // "" would be stored as an empty string and never match a lookup; null is
      // the value that means "any brand".
      finishingBrandId: stored.finishingBrandId || null,
      pricePerSqft: Number(intDraft.pricePerSqft),
    };
    if (editId) await updateInteriorRate(editId, payload);
    else await createInteriorRate(payload);
    setIntDraft(blankInterior);
    setEditId(null);
    setSaving(false);
    loadAll();
  };

  const editInterior = (row) => {
    setEditId(row._id);
    setIntDraft({
      finishingTypeId: "",
      finishingCategoryId: row.finishingCategoryId,
      finishingBrandId: row.finishingBrandId || "",
      pricePerSqft: row.pricePerSqft,
    });
  };

  const deleteInterior = async (id) => {
    if (!window.confirm("Delete this interior rate?")) return;
    await removeInteriorRate(id);
    loadAll();
  };

  // ---- hardware actions ----
  const saveHardware = async () => {
    if (!hwDraft.name || !hwDraft.price) {
      alert("Enter a hardware name and value.");
      return;
    }
    setSaving(true);
    const payload = { name: hwDraft.name, price: Number(hwDraft.price) };
    if (editId) await updateHardware(editId, payload);
    else await createHardware(payload);
    setHwDraft({ name: "", price: "" });
    setEditId(null);
    setSaving(false);
    loadAll();
  };

  const editHardware = (row) => {
    setEditId(row._id);
    setHwDraft({ name: row.name, price: row.price });
  };

  const deleteHardware = async (id) => {
    if (!window.confirm("Delete this hardware item?")) return;
    await removeHardware(id);
    loadAll();
  };

  // ---- installation rate ----
  const saveInstallation = async () => {
    setSaving(true);
    setInstallError("");
    setInstallSaved(false);
    const res = await saveInstallationRate(Number(installationRate) || 0);
    setSaving(false);
    if (res?.ok) {
      setInstallEditing(false);
      setInstallSaved(true);
    } else {
      setInstallError(res?.error || "Could not save the installation rate.");
    }
  };

  if (!isAdmin) {
    return (
      <div className="pz-app-shell">
        <NavRail variant="app" />
        <Container className="py-4">
          <Alert variant="warning">
            You don’t have access to the Rate Card. This screen is available to
            admins only.
          </Alert>
        </Container>
      </div>
    );
  }

  return (
    <div className="pz-app-shell">
      <NavRail variant="app" />
      <Container fluid className="py-4 px-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="mb-0 fw-semibold">Masters · Rate Card</h4>
        <div className="d-flex gap-2">
          {tab === "material" || tab === "coating" || tab === "interior" ? (
            <Button
              variant={showLists ? "secondary" : "outline-secondary"}
              size="sm"
              onClick={() => setShowLists((v) => !v)}
              title="Add, rename or remove the materials, grades and brands these dropdowns offer"
            >
              Manage lists
            </Button>
          ) : null}
          <Button variant="outline-secondary" size="sm" onClick={loadAll}>
            Refresh
          </Button>
        </div>
      </div>
      <p className="text-muted" style={{ fontSize: 13 }}>
        These rates feed the 3D editor’s material / coating pickers and price the
        BOQ. Changes here apply everywhere.
      </p>

      {loading ? (
        <div className="d-flex align-items-center gap-2 py-5">
          <Spinner animation="border" size="sm" /> Loading rate card…
        </div>
      ) : (
        <div className="d-flex gap-3 align-items-start">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
        <Tabs
          activeKey={tab}
          onSelect={(k) => {
            setTab(k);
            cancelEdit();
          }}
          className="mb-3"
        >
          {/* ---------------- MATERIAL ---------------- */}
          <Tab eventKey="material" title="Material rates">
            <Row className="g-2 align-items-end mb-3">
              <Col md={3}>
                <Form.Label className="small fw-semibold">Material</Form.Label>
                <Form.Select
                  value={matDraft.coreMaterialTypeId}
                  onChange={(e) =>
                    setMatDraft({
                      ...matDraft,
                      coreMaterialTypeId: e.target.value,
                      grade: "",
                    })
                  }
                >
                  <option value="">Select…</option>
                  {materialTypes.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.type}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label className="small fw-semibold">Grade</Form.Label>
                <Form.Select
                  value={matDraft.grade}
                  onChange={(e) =>
                    setMatDraft({ ...matDraft, grade: e.target.value })
                  }
                  disabled={!gradesForType.length}
                >
                  <option value="">—</option>
                  {gradesForType.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label className="small fw-semibold">Brand</Form.Label>
                <Form.Select
                  value={matDraft.brandId}
                  onChange={(e) =>
                    setMatDraft({ ...matDraft, brandId: e.target.value })
                  }
                >
                  <option value="">Select…</option>
                  {coreBrands.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label className="small fw-semibold">₹ / sqft</Form.Label>
                <Form.Control
                  type="number"
                  value={matDraft.pricePerSqft || ""}
                  onChange={(e) =>
                    setMatDraft({ ...matDraft, pricePerSqft: e.target.value })
                  }
                />
              </Col>
              <Col md={2} className="d-flex gap-2">
                <Button
                  variant="primary"
                  onClick={saveMaterial}
                  disabled={saving}
                >
                  {editId ? "Update" : "Add"}
                </Button>
                {editId ? (
                  <Button variant="outline-secondary" onClick={cancelEdit}>
                    Cancel
                  </Button>
                ) : null}
              </Col>
            </Row>

            <Table hover responsive size="sm" className="align-middle">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Grade</th>
                  <th>Brand</th>
                  <th className="text-end">₹ / sqft</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {materialRates.length ? (
                  materialRates.map((r) => (
                    <tr key={r._id}>
                      <td>{typeName(r.coreMaterialTypeId)}</td>
                      <td>{r.grade || "—"}</td>
                      <td>{coreBrandName(r.brandId)}</td>
                      <td className="text-end">₹{r.pricePerSqft}</td>
                      <td className="text-end">
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => editMaterial(r)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          className="text-danger"
                          onClick={() => deleteMaterial(r._id)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-3">
                      No material rates yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Tab>

          {/* ---------------- COATING ---------------- */}
          <Tab eventKey="coating" title="Coating rates">
            <Row className="g-2 align-items-end mb-3">
              <Col md={3}>
                <Form.Label className="small fw-semibold">
                  Finish type
                </Form.Label>
                <Form.Select
                  value={coatDraft.finishingTypeId}
                  onChange={(e) =>
                    setCoatDraft({
                      ...coatDraft,
                      finishingTypeId: e.target.value,
                      // The chosen grade belongs to the OLD type, so it is
                      // cleared — leaving it would save a Laminates grade
                      // under Paint Finishes.
                      finishingCategoryId: "",
                    })
                  }
                >
                  <option value="">Select…</option>
                  {finishTypes.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              {/* Finish type → Brand → Grade. Brand sits between the two
                  catalogue fields it is independent of; only Grade cascades
                  from Finish type, and it still does. */}
              <Col md={2}>
                <Form.Label className="small fw-semibold">Brand</Form.Label>
                <Form.Select
                  value={coatDraft.finishingBrandId}
                  onChange={(e) =>
                    setCoatDraft({
                      ...coatDraft,
                      finishingBrandId: e.target.value,
                    })
                  }
                >
                  <option value="">Select…</option>
                  {finishBrands.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label className="small fw-semibold">Grade</Form.Label>
                <Form.Select
                  value={coatDraft.finishingCategoryId}
                  disabled={!coatDraft.finishingTypeId}
                  onChange={(e) =>
                    setCoatDraft({
                      ...coatDraft,
                      finishingCategoryId: e.target.value,
                    })
                  }
                >
                  <option value="">
                    {coatDraft.finishingTypeId
                      ? finishGradesForType.length
                        ? "Select…"
                        : "No grades under this type"
                      : "Pick a finish type first"}
                  </option>
                  {finishGradesForType.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label className="small fw-semibold">₹ / sqft</Form.Label>
                <Form.Control
                  type="number"
                  value={coatDraft.pricePerSqft || ""}
                  onChange={(e) =>
                    setCoatDraft({
                      ...coatDraft,
                      pricePerSqft: e.target.value,
                    })
                  }
                />
              </Col>
              <Col md={2} className="d-flex gap-2">
                <Button variant="primary" onClick={saveCoating} disabled={saving}>
                  {editId ? "Update" : "Add"}
                </Button>
                {editId ? (
                  <Button variant="outline-secondary" onClick={cancelEdit}>
                    Cancel
                  </Button>
                ) : null}
              </Col>
            </Row>

            <Table hover responsive size="sm" className="align-middle">
              <thead>
                <tr>
                  <th>Finish type</th>
                  <th>Brand</th>
                  <th>Grade</th>
                  <th className="text-end">₹ / sqft</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coatingRates.length ? (
                  coatingRates.map((r) => (
                    <tr key={r._id}>
                      <td>{finishTypeNameOfGrade(r.finishingCategoryId)}</td>
                      <td>{finBrandName(r.finishingBrandId)}</td>
                      <td>{catName(r.finishingCategoryId)}</td>
                      <td className="text-end">₹{r.pricePerSqft}</td>
                      <td className="text-end">
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => editCoating(r)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          className="text-danger"
                          onClick={() => deleteCoating(r._id)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-3">
                      No coating rates yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Tab>

          {/* ---------------- INTERIOR ----------------
              The INSIDE of a carcass — inner lamination. Its own tab and its
              own table because it is a different material at a different price:
              white paper at tens of rupees a square foot against a decorative
              laminate at hundreds. It names the same finish types and grades as
              the coating rates; only the price is separate. */}
          <Tab eventKey="interior" title="Interior rates">
            <Row className="g-2 align-items-end mb-3">
              {/* NO GRADE HERE. One inner lamination rate covers the whole
                  type: the inside of a carcass is white paper, not a chosen
                  decor, so splitting it into Wood Grain / Stone / Solid Colour
                  would be a distinction nobody prices. The rate is therefore
                  saved against the TYPE, and the BOQ resolves a part's grade up
                  to its type when it looks the rate up. */}
              <Col md={4}>
                <Form.Label className="small fw-semibold">
                  Finish type
                </Form.Label>
                <Form.Select
                  value={intDraft.finishingCategoryId}
                  onChange={(e) =>
                    setIntDraft({
                      ...intDraft,
                      finishingCategoryId: e.target.value,
                    })
                  }
                >
                  <option value="">Select…</option>
                  {interiorTypes.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label className="small fw-semibold">Brand</Form.Label>
                <Form.Select
                  value={intDraft.finishingBrandId}
                  onChange={(e) =>
                    setIntDraft({
                      ...intDraft,
                      finishingBrandId: e.target.value,
                    })
                  }
                >
                  {/* Optional, and saying so matters: this is the rate used
                      when a part names a brand nothing else is priced for. */}
                  <option value="">Any brand</option>
                  {finishBrands.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label className="small fw-semibold">₹ / sqft</Form.Label>
                <Form.Control
                  type="number"
                  value={intDraft.pricePerSqft || ""}
                  onChange={(e) =>
                    setIntDraft({
                      ...intDraft,
                      pricePerSqft: e.target.value,
                    })
                  }
                />
              </Col>
              <Col md={2} className="d-flex gap-2">
                <Button variant="primary" onClick={saveInterior} disabled={saving}>
                  {editId ? "Update" : "Add"}
                </Button>
                {editId ? (
                  <Button variant="outline-secondary" onClick={cancelEdit}>
                    Cancel
                  </Button>
                ) : null}
              </Col>
            </Row>

            <Table hover responsive size="sm" className="align-middle">
              <thead>
                <tr>
                  <th>Finish type</th>
                  <th>Brand</th>
                  <th className="text-end">₹ / sqft</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {interiorRates.length ? (
                  interiorRates.map((r) => (
                    <tr key={r._id}>
                      <td>{catName(r.finishingCategoryId)}</td>
                      <td>
                        {r.finishingBrandId ? (
                          finBrandName(r.finishingBrandId)
                        ) : (
                          <span className="text-muted">Any brand</span>
                        )}
                      </td>
                      <td className="text-end">₹{r.pricePerSqft}</td>
                      <td className="text-end">
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => editInterior(r)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          className="text-danger"
                          onClick={() => deleteInterior(r._id)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="text-center text-muted py-3">
                      No interior rates yet — the inside of every carcass is
                      costing ₹0 until one is added.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Tab>

          {/* ---------------- HARDWARE ---------------- */}
          <Tab eventKey="hardware" title="Hardware">
            <Row className="g-2 align-items-end mb-3">
              <Col md={5}>
                <Form.Label className="small fw-semibold">Name</Form.Label>
                <Form.Control
                  value={hwDraft.name}
                  onChange={(e) =>
                    setHwDraft({ ...hwDraft, name: e.target.value })
                  }
                />
              </Col>
              <Col md={3}>
                <Form.Label className="small fw-semibold">Value (₹)</Form.Label>
                <Form.Control
                  type="number"
                  value={hwDraft.price}
                  onChange={(e) =>
                    setHwDraft({ ...hwDraft, price: e.target.value })
                  }
                />
              </Col>
              <Col md={4} className="d-flex gap-2">
                <Button
                  variant="primary"
                  onClick={saveHardware}
                  disabled={saving}
                >
                  {editId ? "Update" : "Add"}
                </Button>
                {editId ? (
                  <Button variant="outline-secondary" onClick={cancelEdit}>
                    Cancel
                  </Button>
                ) : null}
              </Col>
            </Row>

            <Table hover responsive size="sm" className="align-middle">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-end">Value</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {hardware.length ? (
                  hardware.map((r) => (
                    <tr key={r._id}>
                      <td>{r.name}</td>
                      <td className="text-end">₹{r.price}</td>
                      <td className="text-end">
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => editHardware(r)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          className="text-danger"
                          onClick={() => deleteHardware(r._id)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="text-center text-muted py-3">
                      No hardware yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Tab>

          {/* ---------------- INSTALLATION ---------------- */}
          <Tab eventKey="installation" title="Installation">
            <div style={{ maxWidth: 420 }}>
              <Form.Label className="small fw-semibold">
                Installation rate (₹ / sqft)
              </Form.Label>
              <div className="d-flex gap-2 align-items-center">
                <Form.Control
                  type="number"
                  value={installationRate}
                  disabled={!installEditing}
                  onChange={(e) => {
                    setInstallationRateState(e.target.value);
                    setInstallSaved(false);
                  }}
                />
                {installEditing ? (
                  <Button
                    variant="primary"
                    onClick={saveInstallation}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </Button>
                ) : (
                  <Button
                    variant="outline-primary"
                    onClick={() => {
                      setInstallEditing(true);
                      setInstallSaved(false);
                      setInstallError("");
                    }}
                  >
                    Edit
                  </Button>
                )}
              </div>
              <div className="text-muted mt-2" style={{ fontSize: 12 }}>
                A single global rate applied to the whole estimate.
              </div>
              {installSaved ? (
                <Alert variant="success" className="mt-3 py-2">
                  Installation rate saved.
                </Alert>
              ) : null}
              {installError ? (
                <Alert variant="danger" className="mt-3 py-2">
                  {installError}
                </Alert>
              ) : null}
            </div>
          </Tab>
        </Tabs>
        </div>
        {/* Only the two tabs that HAVE lists behind them. Hardware is free text
            and Installation is a single number, so neither has a catalogue to
            maintain and offering the drawer there would be a dead end. */}
        {showLists && (tab === "material" || tab === "coating" || tab === "interior") ? (
          <ManageLists
            tab={tab}
            data={{
              materialTypes,
              coreBrands,
              finishCategories,
              finishBrands,
              materialRates,
              coatingRates,
              interiorRates,
              // The drawer must list the same types the Interior tab can
              // actually price, or it offers Paint and Glass beside a dropdown
              // that will never show them.
              interiorTypes,
            }}
            onClose={() => setShowLists(false)}
            onChanged={loadAll}
          />
        ) : null}
        </div>
      )}
      </Container>
    </div>
  );
};

export default RateCard;
