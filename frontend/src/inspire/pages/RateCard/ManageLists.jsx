import React, { useState } from "react";
import { Button, Form, Spinner } from "react-bootstrap";
import {
  coreMaterialTypes,
  coreMaterialBrands,
  finishingCategories,
  finishingBrands,
  setGrades,
} from "../../services/ratesService";

/**
 * MANAGE LISTS — the catalogue behind the rate-card dropdowns.
 *
 * The rate tabs have always let you price a combination; they have never let
 * you create one. Adding a board, a grade or a brand meant an edit straight
 * into the database, so the lists drift from what is actually sold and nobody
 * outside engineering can correct them.
 *
 * It shows the lists THE TAB THAT OPENED IT ACTUALLY USES:
 *
 *   Material rates  — materials, grades and board brands
 *   Coating rates   — finish types, their grades, and finish brands
 *   Interior rates  — finish types and finish brands only
 *
 * Interior has no grades: one rate covers a whole type, because the inside of a
 * carcass is white inner lamination rather than a chosen decor. Showing them
 * there listed thirteen rows that could not affect an interior rate and buried
 * the two lists that could.
 *
 * Coating and Interior edit the SAME catalogue — one set of types and brands,
 * two rate tables — so a rename on one tab shows up on the other, and Delete
 * counts the rates in BOTH before it will remove anything.
 *
 * MATERIALS AND GRADES ARE SEPARATE SECTIONS BUT NOT SEPARATE RECORDS. A grade
 * is a string inside its material's `grades` array, so every grade row names
 * its material and adding one means choosing a material first. Deleting a
 * material therefore takes its grades with it — the confirm says so.
 *
 * AN ENTRY A RATE STILL NAMES CANNOT BE REMOVED. The rate would be left
 * pointing at nothing and would render as a blank dropdown rather than an
 * error, so Delete refuses and says how many rates are holding it.
 *
 * Edit and Delete are always SHOWN. An earlier version hid them and printed
 * the use count on every row instead, which put a number next to every entry
 * to explain a control that was missing. The rule is the same; it is now
 * stated at the moment it applies, where it reads as an answer rather than as
 * standing clutter.
 */

// `renameBlocked` / `deleteBlocked` are the REASON an action cannot proceed, or
// null when it can. Edit and Delete are always visible — a control that simply
// vanishes teaches nobody why — and clicking a blocked one says what is holding
// the entry instead of silently doing nothing.
const Row = ({
  label,
  onRename,
  onDelete,
  busy,
  children,
  renameBlocked = null,
  deleteBlocked = null,
}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(label);
  return (
    <div className="border-bottom px-2 py-1">
      <div className="d-flex align-items-center gap-2">
        {editing ? (
          <>
            <Form.Control
              size="sm"
              value={text}
              autoFocus
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && text.trim()) {
                  onRename(text.trim());
                  setEditing(false);
                }
              }}
            />
            <Button
              size="sm"
              variant="link"
              className="p-0"
              disabled={busy || !text.trim()}
              onClick={() => {
                onRename(text.trim());
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="link"
              className="p-0 text-muted"
              onClick={() => {
                setText(label);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="flex-grow-1">{label}</span>
            <Button
              size="sm"
              variant="link"
              className="p-0"
              disabled={busy}
              onClick={() => {
                if (renameBlocked) {
                  alert(renameBlocked);
                  return;
                }
                setText(label);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="link"
              className="p-0 text-danger"
              disabled={busy}
              onClick={() => {
                if (deleteBlocked) {
                  alert(deleteBlocked);
                  return;
                }
                onDelete();
              }}
            >
              Delete
            </Button>
          </>
        )}
      </div>
      {children}
    </div>
  );
};

const AddRow = ({ placeholder, onAdd, busy }) => {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText("");
  };
  return (
    <div className="d-flex gap-2 px-2 py-2 bg-light">
      <Form.Control
        size="sm"
        placeholder={placeholder}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <Button size="sm" disabled={busy || !text.trim()} onClick={add}>
        Add
      </Button>
    </div>
  );
};

const ManageLists = ({ tab, data, onClose, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const {
    materialTypes = [],
    coreBrands = [],
    finishCategories = [],
    finishBrands = [],
    materialRates = [],
    coatingRates = [],
    interiorRates = [],
    interiorTypes = [],
  } = data || {};

  // Run a change, then reload the page's data so the counts and every dropdown
  // reflect it. Reloading rather than patching state locally: a rename changes
  // what the rate rows display too, and those are derived from these lists.
  // The write services throw with the backend's own message, so say WHAT went
  // wrong. "Could not be saved. Please try again." is the same sentence for an
  // expired session and a server fault, and only one of those is worth retrying.
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      alert(`That change could not be saved.\n\n${e?.message || "Unknown error"}`);
      return;
    } finally {
      setBusy(false);
    }
    await onChanged();
  };

  const isMaterial = tab === "material";
  // The INTERIOR tab prices one rate per finish TYPE and has no grades, so its
  // drawer must not offer them — a grade edited here could never affect an
  // interior rate, and listing thirteen of them buried the two lists that can.
  const isInterior = tab === "interior";

  // A FINISH TYPE, GRADE OR BRAND IS HELD BY BOTH RATE TABLES.
  //
  // Coating rates price the outside, interior rates the inside, and both name
  // this same catalogue. Counting only the coating ones would offer Delete on a
  // grade that interior rates still point at, and silently strand them.
  const finishRates = [...coatingRates, ...interiorRates];

  // A finish category with no parent is a TYPE; its children are its GRADES.
  const finishTypes = finishCategories.filter((c) => !c.parentCategoryId);
  const gradesOf = (parentId) =>
    finishCategories.filter((c) => c.parentCategoryId === parentId);

  // How many rate rows name each entry. This is what decides whether Delete is
  // allowed, so it is counted from the rates themselves rather than assumed.
  const useCount = (pred, rows) => rows.filter(pred).length;

  // The two reasons an action is refused, written as the sentence the user
  // sees. Both return null when nothing is in the way, which is what Row reads
  // as "allowed".
  const heldBy = (uses, name) =>
    uses
      ? `"${name}" is used by ${uses} rate${uses === 1 ? "" : "s"}.\n\n` +
        `Delete or re-point those rates first — removing it now would leave ` +
        `them pointing at nothing.`
      : null;

  // Only grades. A rate stores its material and brand by id, so those rename
  // freely; a grade is stored as the WORD, so renaming it strands the rates.
  const renameHeldBy = (uses, name) =>
    uses
      ? `"${name}" is used by ${uses} rate${uses === 1 ? "" : "s"}.\n\n` +
        `A rate stores its grade by name, so renaming this one would leave ` +
        `those rates pointing at a grade that no longer exists.`
      : null;

  return (
    // 360 rather than 300: a grade row carries "Material · Grade" plus the use
    // count, Edit and Delete, which wraps at the narrower width.
    //
    // THE DRAWER SCROLLS ON ITS OWN. Three sections of rows outgrow the window
    // as soon as a few grades exist, and the page's own scrollbar is no help —
    // it moves the rates table too, so Add sits off-screen while you are
    // reading the list you want to add to. Capping the height and scrolling
    // the body keeps the header, the Close link and every Add row reachable.
    // `sticky` keeps the drawer in view while the rates table scrolls past it.
    <div
      className="border rounded bg-white d-flex flex-column"
      style={{
        width: 360,
        position: "sticky",
        top: 16,
        maxHeight: "calc(100vh - 140px)",
      }}
    >
      <div className="d-flex align-items-center justify-content-between px-2 py-2 border-bottom flex-shrink-0">
        <strong style={{ fontSize: 14 }}>Manage lists</strong>
        <div className="d-flex align-items-center gap-2">
          {busy ? <Spinner animation="border" size="sm" /> : null}
          <Button size="sm" variant="link" className="p-0" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {/* minHeight:0 — without it a flex child refuses to shrink below its
          content and the overflow never engages. */}
      <div className="flex-grow-1" style={{ overflowY: "auto", minHeight: 0 }}>

      {isMaterial ? (
        <>
          <div className="px-2 py-1 bg-light border-bottom">
            <small className="text-muted">MATERIALS</small>
          </div>
          {materialTypes.map((t) => (
            <Row
              key={t._id}
              label={t.type}
              busy={busy}
              deleteBlocked={heldBy(
                useCount((r) => r.coreMaterialTypeId === t._id, materialRates),
                t.type
              )}
              // Rename is always safe here, unlike a grade: a rate stores the
              // material as `coreMaterialTypeId`, so the id keeps the rates
              // attached however the name changes.
              onRename={(type) => run(() => coreMaterialTypes.update(t._id, { type }))}
              onDelete={() => {
                // Deleting a material takes its grades with it — they are
                // stored inside it, so there is nowhere for them to survive.
                const g = (t.grades || []).length;
                const warn = g
                  ? `Delete "${t.type}" and its ${g} grade${g === 1 ? "" : "s"} (${(
                      t.grades || []
                    ).join(", ")})?`
                  : `Delete the material "${t.type}"?`;
                return (
                  window.confirm(warn) &&
                  run(() => coreMaterialTypes.remove(t._id))
                );
              }}
            />
          ))}
          <AddRow
            placeholder="New material name"
            busy={busy}
            onAdd={(type) =>
              run(() => coreMaterialTypes.create({ type, grades: [] }))
            }
          />

          {/* GRADES, flat.
              A grade is a string inside ONE material's `grades` array, not a
              record of its own, so each row has to name the material it
              belongs to: "BWP" means nothing on its own, and Plywood BWP and a
              future MDF BWP would be two different things priced differently.
              A material with no grades yet simply contributes no rows — pick it
              in the Material box below to give it its first one. */}
          <div className="px-2 py-1 bg-light border-top border-bottom">
            <small className="text-muted">GRADES</small>
          </div>
          {materialTypes.flatMap((t) =>
            (t.grades || []).map((g) => {
              const uses = useCount(
                (r) => r.coreMaterialTypeId === t._id && r.grade === g,
                materialRates
              );
              return (
                <Row
                  key={`${t._id}:${g}`}
                  label={`${t.type} · ${g}`}
                  busy={busy}
                  // A grade is the only entry here that cannot be renamed
                  // while in use — see renameHeldBy.
                  renameBlocked={renameHeldBy(uses, `${t.type} · ${g}`)}
                  deleteBlocked={heldBy(uses, `${t.type} · ${g}`)}
                  onRename={(name) => {
                    // The row reads "Material · Grade", so accept either the
                    // whole label back or just the grade part of it.
                    const next = name.includes("·")
                      ? name.split("·").pop().trim()
                      : name.trim();
                    if (!next || next === g) return;
                    // setGrades de-duplicates, so renaming onto a grade that
                    // already exists would silently merge the two rather than
                    // rename one. Say so instead of quietly losing a row.
                    if ((t.grades || []).includes(next)) {
                      alert(`${t.type} already has a grade called "${next}".`);
                      return;
                    }
                    return run(() =>
                      setGrades(
                        t._id,
                        (t.grades || []).map((x) => (x === g ? next : x))
                      )
                    );
                  }}
                  onDelete={() =>
                    window.confirm(`Delete the grade "${t.type} · ${g}"?`) &&
                    run(() =>
                      setGrades(
                        t._id,
                        (t.grades || []).filter((x) => x !== g)
                      )
                    )
                  }
                />
              );
            })
          )}
          <GradeAddRow
            busy={busy}
            materials={materialTypes}
            onAdd={(typeId, name) => {
              const t = materialTypes.find((x) => x._id === typeId);
              if (!t) return;
              run(() => setGrades(typeId, [...(t.grades || []), name]));
            }}
          />

          <div className="px-2 py-1 bg-light border-top border-bottom">
            <small className="text-muted">BOARD BRANDS</small>
          </div>
          {coreBrands.map((b) => (
            <Row
              key={b._id}
              label={b.name}
              busy={busy}
              deleteBlocked={heldBy(
                useCount((r) => r.brandId === b._id, materialRates),
                b.name
              )}
              onRename={(name) =>
                run(() => coreMaterialBrands.update(b._id, { name }))
              }
              onDelete={() =>
                window.confirm(`Delete the brand "${b.name}"?`) &&
                run(() => coreMaterialBrands.remove(b._id))
              }
            />
          ))}
          <AddRow
            placeholder="New brand name"
            busy={busy}
            onAdd={(name) => run(() => coreMaterialBrands.create({ name }))}
          />
        </>
      ) : isInterior ? (
        <>
          {/* INTERIOR — finish types and brands, and nothing else.
              An interior rate is one price per TYPE: the inside of a carcass is
              white inner lamination, not a chosen decor, so there is no grade
              to manage. These two lists are the SAME ones the coating tab
              edits — one catalogue, two rate tables — so a rename here shows up
              there too. */}
          <div className="px-2 py-1 bg-light border-bottom">
            <small className="text-muted">FINISH TYPES</small>
          </div>
          {interiorTypes.map((parent) => (
            <Row
              key={parent._id}
              label={parent.name}
              busy={busy}
              deleteBlocked={
                heldBy(
                  useCount(
                    (r) => r.finishingCategoryId === parent._id,
                    finishRates
                  ),
                  parent.name
                ) ||
                (gradesOf(parent._id).length
                  ? `"${parent.name}" still has ${gradesOf(parent._id).length} ` +
                    `grade${gradesOf(parent._id).length === 1 ? "" : "s"} ` +
                    `(${gradesOf(parent._id)
                      .map((g) => g.name)
                      .join(", ")}).

Delete those first, on the Coating tab.`
                  : null)
              }
              onRename={(name) =>
                run(() => finishingCategories.update(parent._id, { name }))
              }
              onDelete={() =>
                window.confirm(`Delete the finish type "${parent.name}"?`) &&
                run(() => finishingCategories.remove(parent._id))
              }
            />
          ))}
          {/* NO ADD BOX HERE, deliberately.
              This list is filtered to the types the Interior tab can price, so
              a type added here under any other name would be created and then
              vanish from the list — saved, invisible, and apparently broken.
              Finish types belong to the shared catalogue; the Coating tab is
              where the whole list is, so that is where they are added. */}
          <div className="px-2 py-2 bg-light" style={{ fontSize: 11.5 }}>
            <span className="text-muted">
              Finish types are shared with Coating — add or remove the full list
              on the Coating rates tab.
            </span>
          </div>

          <div className="px-2 py-1 bg-light border-top border-bottom">
            <small className="text-muted">FINISH BRANDS</small>
          </div>
          {finishBrands.map((b) => (
            <Row
              key={b._id}
              label={b.name}
              busy={busy}
              deleteBlocked={heldBy(
                useCount((r) => r.finishingBrandId === b._id, finishRates),
                b.name
              )}
              onRename={(name) =>
                run(() => finishingBrands.update(b._id, { name }))
              }
              onDelete={() =>
                window.confirm(`Delete the brand "${b.name}"?`) &&
                run(() => finishingBrands.remove(b._id))
              }
            />
          ))}
          <AddRow
            placeholder="New brand name"
            busy={busy}
            onAdd={(name) => run(() => finishingBrands.create({ name }))}
          />
        </>
      ) : (
        <>
          {/* Laid out exactly like the material tab — type, then grade, then
              brand — because the Coating form now picks them in that order.
              A finish category with no parent IS a finish type; one WITH a
              parent is a grade sold under it. Same collection, two sections,
              so the drawer reads the way the form is filled in. */}
          <div className="px-2 py-1 bg-light border-bottom">
            <small className="text-muted">FINISH TYPES</small>
          </div>
          {finishTypes.map((parent) => (
            <Row
              key={parent._id}
              label={parent.name}
              busy={busy}
              deleteBlocked={
                // A type is held by its own rates AND by any grade under it —
                // deleting it would leave those grades parented to nothing.
                heldBy(
                  useCount(
                    (r) => r.finishingCategoryId === parent._id,
                    finishRates
                  ),
                  parent.name
                ) ||
                (gradesOf(parent._id).length
                  ? `"${parent.name}" still has ${gradesOf(parent._id).length} ` +
                    `grade${gradesOf(parent._id).length === 1 ? "" : "s"} ` +
                    `(${gradesOf(parent._id)
                      .map((g) => g.name)
                      .join(", ")}).\n\nDelete those first.`
                  : null)
              }
              onRename={(name) =>
                run(() => finishingCategories.update(parent._id, { name }))
              }
              onDelete={() =>
                window.confirm(`Delete the finish type "${parent.name}"?`) &&
                run(() => finishingCategories.remove(parent._id))
              }
            />
          ))}
          <AddRow
            placeholder="New finish type"
            busy={busy}
            onAdd={(name) =>
              run(() =>
                finishingCategories.create({
                  name,
                  parentCategoryId: null,
                  // Every existing category is 'wall'; a new top-level type
                  // follows them rather than inventing a surface.
                  type: "wall",
                })
              )
            }
          />

          <div className="px-2 py-1 bg-light border-top border-bottom">
            <small className="text-muted">GRADES</small>
          </div>
          {finishTypes.flatMap((parent) =>
            gradesOf(parent._id).map((style) => (
              <Row
                key={style._id}
                // "Laminates · Wood Grain", matching the material grades above.
                label={`${parent.name} · ${style.name}`}
                busy={busy}
                deleteBlocked={heldBy(
                  useCount(
                    (r) => r.finishingCategoryId === style._id,
                    finishRates
                  ),
                  `${parent.name} · ${style.name}`
                )}
                // Unlike a material grade, this one is a record with an id —
                // the rate points at the id, so renaming is always safe.
                onRename={(name) => {
                  const next = name.includes("·")
                    ? name.split("·").pop().trim()
                    : name.trim();
                  if (!next || next === style.name) return;
                  return run(() =>
                    finishingCategories.update(style._id, { name: next })
                  );
                }}
                onDelete={() =>
                  window.confirm(
                    `Delete the grade "${parent.name} · ${style.name}"?`
                  ) && run(() => finishingCategories.remove(style._id))
                }
              />
            ))
          )}
          <FinishGradeAddRow
            busy={busy}
            types={finishTypes}
            onAdd={(parentId, name) => {
              const parent = finishTypes.find((x) => x._id === parentId);
              if (!parent) return;
              run(() =>
                finishingCategories.create({
                  name,
                  parentCategoryId: parentId,
                  // Carried from the parent: a grade covers the same surface
                  // as the type it sits under.
                  type: parent.type,
                })
              );
            }}
          />

          <div className="px-2 py-1 bg-light border-top border-bottom">
            <small className="text-muted">FINISH BRANDS</small>
          </div>
          {finishBrands.map((b) => (
            <Row
              key={b._id}
              label={b.name}
              busy={busy}
              deleteBlocked={heldBy(
                useCount((r) => r.finishingBrandId === b._id, finishRates),
                b.name
              )}
              onRename={(name) =>
                run(() => finishingBrands.update(b._id, { name }))
              }
              onDelete={() =>
                window.confirm(`Delete the brand "${b.name}"?`) &&
                run(() => finishingBrands.remove(b._id))
              }
            />
          ))}
          <AddRow
            placeholder="New brand name"
            busy={busy}
            onAdd={(name) => run(() => finishingBrands.create({ name }))}
          />
        </>
      )}
      </div>
    </div>
  );
};

/**
 * Add a grade.
 *
 * Two fields rather than one, because a grade is stored inside a material and
 * a bare name has nowhere to go: "BWP" has to be written into Plywood's
 * `grades` array or it is not written at all. The material is a picker, not a
 * list, so nothing here can create or destroy a material.
 */
const GradeAddRow = ({ busy, materials, onAdd }) => (
  <PickThenNameRow
    busy={busy}
    options={materials.map((m) => ({ id: m._id, label: m.type }))}
    pickLabel="Material…"
    placeholder="New grade"
    onAdd={onAdd}
  />
);

/**
 * Add a finish grade.
 *
 * Same two fields as above and for the same reason — a grade belongs under one
 * finish type — though here the grade IS its own record, carrying the chosen
 * type as `parentCategoryId` rather than living inside it.
 */
const FinishGradeAddRow = ({ busy, types, onAdd }) => (
  <PickThenNameRow
    busy={busy}
    options={types.map((t) => ({ id: t._id, label: t.name }))}
    pickLabel="Finish type…"
    placeholder="New grade"
    onAdd={onAdd}
  />
);

/** Pick a parent, name the child, Add. Shared by both grade sections. */
const PickThenNameRow = ({ busy, options, pickLabel, placeholder, onAdd }) => {
  const [parentId, setParentId] = useState("");
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (!v || !parentId) return;
    onAdd(parentId, v);
    setText("");
  };
  return (
    <div className="d-flex gap-2 px-2 py-2 bg-light">
      <Form.Select
        size="sm"
        style={{ maxWidth: 130 }}
        value={parentId}
        disabled={busy}
        onChange={(e) => setParentId(e.target.value)}
      >
        <option value="">{pickLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Form.Select>
      <Form.Control
        size="sm"
        placeholder={placeholder}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <Button
        size="sm"
        disabled={busy || !text.trim() || !parentId}
        onClick={add}
      >
        Add
      </Button>
    </div>
  );
};

export default ManageLists;
