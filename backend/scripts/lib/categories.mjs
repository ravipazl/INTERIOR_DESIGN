// Finds a cabinet category by any of the names it goes by.
//
// The same group of cabinets is named differently on different machines:
//
//   group   dev PC                   live server
//   tall    "Tall Units"             "Tall Unit"
//   below   "Below Counter Storage"  "Below Counter Storage"
//   wall    "Wall Unit"              "Above Counter Storage"
//
// So scripts never look a category up by one exact string. For each group:
//   1. an environment override (e.g. TALL_UNITS_CATEGORY="Tall Unit") — if set,
//      ONLY that name is used, so a typo fails loudly instead of silently
//      falling back;
//   2. otherwise the known names, in order; the first one that exists wins
//      (exact match first, then ignoring case and extra spaces).
// If nothing matches, the error lists the categories that DO exist, with their
// model counts, so the right name is obvious.

export const CABINET_GROUPS = {
  tall: {
    label: 'Tall Units',
    env: 'TALL_UNITS_CATEGORY',
    names: ['Tall Units', 'Tall Unit'],
    backupFolder: 'glb-original-tall-units'
  },
  below: {
    label: 'Below Counter Storage',
    env: 'BELOW_COUNTER_CATEGORY',
    names: ['Below Counter Storage'],
    backupFolder: 'glb-original-below-counter'
  },
  wall: {
    label: 'Wall Units',
    env: 'WALL_UNITS_CATEGORY',
    names: ['Wall Unit', 'Wall Units', 'Above Counter Storage'],
    backupFolder: 'glb-original-wall-unit'
  }
}

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * The group a name or key belongs to ("tall", "Tall Unit", "Above Counter
 * Storage" …), or null for a name outside the known groups.
 */
export function groupOf(nameOrKey) {
  if (CABINET_GROUPS[nameOrKey]) return { key: nameOrKey, ...CABINET_GROUPS[nameOrKey] }
  const n = norm(nameOrKey)
  for (const [key, g] of Object.entries(CABINET_GROUPS)) {
    if (norm(g.label) === n || g.names.some((x) => norm(x) === n)) return { key, ...g }
  }
  return null
}

/**
 * Names to try, in order. A group key uses its env override or its known names.
 * An explicit name is tried FIRST, then (if it belongs to a group) the group's
 * other names — so `--category "Wall Unit"` still finds "Above Counter Storage".
 */
export function candidateNames(nameOrKey) {
  const g = groupOf(nameOrKey)
  if (g && process.env[g.env]) return [process.env[g.env]]
  const explicit = CABINET_GROUPS[nameOrKey] ? [] : [nameOrKey]
  return [...new Set([...explicit, ...(g ? g.names : [])])]
}

/** Model counts per category, for the "not found" message. */
async function describeCategories(db) {
  const cats = await db.collection('categories').find({}).project({ name: 1 }).toArray()
  const counts = await db
    .collection('models')
    .aggregate([{ $group: { _id: { $toString: '$categoryId' }, n: { $sum: 1 } } }])
    .toArray()
  const byId = Object.fromEntries(counts.map((c) => [String(c._id), c.n]))
  return cats
    .map((c) => ({ name: c.name, n: byId[String(c._id)] || 0 }))
    .sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name)))
    .map((c) => `  "${c.name}"  ${c.n} model(s)`)
    .join('\n')
}

/**
 * The category document for a group key or name: { cat, name, tried }.
 * Throws — listing the categories that exist — when none of the names match.
 */
export async function findCategory(db, nameOrKey) {
  const tried = candidateNames(nameOrKey)
  const col = db.collection('categories')
  for (const name of tried) {
    const cat = await col.findOne({ name })
    if (cat) return { cat, name: cat.name, tried }
  }
  // Same names, ignoring case / extra spaces ("tall unit ", "TALL UNITS").
  const all = await col.find({}).toArray()
  for (const name of tried) {
    const cat = all.find((c) => norm(c.name) === norm(name))
    if (cat) return { cat, name: cat.name, tried }
  }
  const g = groupOf(nameOrKey)
  const hint = g
    ? `\nSet ${g.env}="<name>" in backend/.env to the right one from the list.`
    : ''
  throw new Error(
    `category not found — tried ${tried.map((t) => `"${t}"`).join(', ')}.\n` +
      `Categories in this database:\n${await describeCategories(db)}${hint}`
  )
}

/** The models of a category (categoryId is stored as a string; accept an ObjectId too). */
export function modelsOf(db, cat, projection) {
  return db
    .collection('models')
    .find({ categoryId: { $in: [String(cat._id), cat._id] } })
    .project(projection)
    .toArray()
}
