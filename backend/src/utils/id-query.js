import { ObjectId } from 'mongodb'

// A project's `_id` (and some catalog rows) can be stored as EITHER a hex
// string or a real ObjectId. Projects are mirrored between the AI and design
// apps: the database where a project is BORN holds a real ObjectId, while the
// mirror copy keeps the id as TEXT. The default MongoDB lookup casts the id to
// an ObjectId, so it silently misses the string-stored copies (this is what
// 404'd "Open Design" and the quote email's project lookup).
//
// `idQuery(id)` builds a query that matches the id in BOTH forms. It is purely
// additive: an exact match still wins; it only adds a fallback for the other
// type. Use it anywhere you look a project up by `_id`.
export const idQuery = (id) => {
  const or = [{ _id: id }]
  if (typeof id === 'string' && ObjectId.isValid(id)) {
    try {
      or.push({ _id: new ObjectId(id) })
    } catch (_) {
      // not a castable id — the string branch above still applies
    }
  }
  return { $or: or }
}
