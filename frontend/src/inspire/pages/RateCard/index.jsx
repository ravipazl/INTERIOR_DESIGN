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
  listHardware,
  createHardware,
  updateHardware,
  removeHardware,
  getInstallationRate,
  setInstallationRate as saveInstallationRate,
} from "../../services/ratesService";

/**
 * Rate Card (Masters) — admin screen to maintain BOQ pricing.
 *
 * MOVED here from the design app (:3031). The data still lives in the DESIGN
 * backend — these are the SAME collections the 3D editor's material/coating
 * pickers read, so a rate added here shows up in the 3D picker AND prices the
 * BOQ. Only the screen moved; no backend or 3D-editor behaviour changed.
 *
 * Four tabs: Material rates (type + grade + brand), Coating rates
 * (category + brand), Hardware, and a single global Installation rate.
 * Admin / super-admin only.
 */

const blankMaterial = {
  coreMaterialTypeId: "",
  grade: "",
  brandId: "",
  pricePerSqft: 0,
};
const blankCoating = {
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
  const [hardware, setHardware] = useState([]);
  const [installationRate, setInstallationRateState] = useState("");

  // drafts
  const [matDraft, setMatDraft] = useState(blankMaterial);
  const [coatDraft, setCoatDraft] = useState(blankCoating);
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
    const [types, cBrands, cats, fBrands, mRates, cRates, hw] =
      await Promise.all([
        getCoreMaterialTypes(),
        getCoreMaterialBrands(),
        getFinishingCategories(),
        getFinishingBrands(),
        listMaterialRates(),
        listCoatingRates(),
        listHardware(),
      ]);
    getInstallationRate().then((r) => setInstallationRateState(r || ""));
    setMaterialTypes(types);
    setCoreBrands(cBrands);
    setFinishCategories(cats);
    setFinishBrands(fBrands);
    setMaterialRates(mRates);
    setCoatingRates(cRates);
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

  const cancelEdit = () => {
    setEditId(null);
    setMatDraft(blankMaterial);
    setCoatDraft(blankCoating);
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
      alert("Pick a coating, a brand, and enter a rate.");
      return;
    }
    setSaving(true);
    const payload = {
      ...coatDraft,
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
      <Container className="py-4">
        <Alert variant="warning">
          You don’t have access to the Rate Card. This screen is available to
          admins only.
        </Alert>
      </Container>
    );
  }

  return (
    <Container fluid className="py-4 px-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="mb-0 fw-semibold">Masters · Rate Card</h4>
        <Button variant="outline-secondary" size="sm" onClick={loadAll}>
          Refresh
        </Button>
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
              <Col md={4}>
                <Form.Label className="small fw-semibold">Coating</Form.Label>
                <Form.Select
                  value={coatDraft.finishingCategoryId}
                  onChange={(e) =>
                    setCoatDraft({
                      ...coatDraft,
                      finishingCategoryId: e.target.value,
                    })
                  }
                >
                  <option value="">Select…</option>
                  {finishCategories.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={3}>
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
              <Col md={3} className="d-flex gap-2">
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
                  <th>Coating</th>
                  <th>Brand</th>
                  <th className="text-end">₹ / sqft</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coatingRates.length ? (
                  coatingRates.map((r) => (
                    <tr key={r._id}>
                      <td>{catName(r.finishingCategoryId)}</td>
                      <td>{finBrandName(r.finishingBrandId)}</td>
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
                    <td colSpan={4} className="text-center text-muted py-3">
                      No coating rates yet.
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
      )}
    </Container>
  );
};

export default RateCard;
