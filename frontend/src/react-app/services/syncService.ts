import BlueprintInterface from "@pazl/blueprint-interface";
import axios from "./apiService";
import { AuthService } from "./authService";
import {
  getEntityByStoreName,
  LocalDBManager,
  localDBObjectStoresList,
} from "./LocalDBManager";

const getDataFromLocalDB = async () => {
  const localDB = new LocalDBManager();
  await localDB.initLocalDB();
  let dataList: any[] = [];
  await Promise.all(
    localDBObjectStoresList.map(async (storeName) => {
      let data: any = await localDB.getDataFromLocalDB(storeName);
      if (data?.length) {
        data = await Promise.all(
          data.map(async (item: any) => {
            let resp = {
              ...item,
              entity: getEntityByStoreName(storeName),
            };
            delete resp.id;
            return resp;
          })
        );
        dataList = dataList.concat(data);
      }
    })
  );
  return dataList;
};

// ── Sync throttling ─────────────────────────────────────────────────────────
// The sync used to POST EVERY local record (200+) every 5 s, and started a new
// POST even while the previous one was still running. The server re-reads and
// re-writes each record, so the requests piled up: the backend sat at 100% CPU
// and the browser's 6 connections to it were all taken by waiting syncs — every
// other request (e.g. an item's part list) queued behind them.
//
// Now: one sync at a time, and only records that CHANGED since they were last
// synced successfully are sent. Nothing is skipped — a changed or new record is
// always sent, and a failed sync is retried in full on the next run.

// What the server last accepted is remembered for this tab across reloads
// (sessionStorage). Without it every reload started from nothing and uploaded
// the whole design again, and the editor stays blank until that upload is
// done (design-boot awaits it). A record is kept as a short fingerprint of its
// JSON, not the JSON itself, so the store stays small. A record whose
// fingerprint differs - new, edited, or never accepted - is always sent.
const SYNCED_KEY = "pz.sync.accepted.v1";

/** A 53-bit string hash (cyrb53): cheap, and a collision is vanishingly rare. */
const fingerprint = (str: string) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ":" + str.length;
};

const loadAccepted = (): Map<string, string> => {
  try {
    const raw = sessionStorage.getItem(SYNCED_KEY);
    return new Map(raw ? (JSON.parse(raw) as [string, string][]) : []);
  } catch {
    return new Map();
  }
};
const saveAccepted = () => {
  try {
    sessionStorage.setItem(SYNCED_KEY, JSON.stringify([...lastSynced]));
  } catch {
    // Storage full or blocked: the in-memory copy still works for this load.
  }
};

/** entity:_id → fingerprint of the JSON last accepted by the server. */
const lastSynced = loadAccepted();
let running: Promise<boolean> | null = null;
let runAgain = false;

const recordKey = (item: any) => `${item?.entity}:${item?._id}`;

const syncChanged = async (): Promise<boolean> => {
  try {
    const all = await getDataFromLocalDB();
    const changed: any[] = [];
    const signatures = new Map<string, string>();
    for (const item of all) {
      const key = recordKey(item);
      const sig = fingerprint(JSON.stringify(item));
      if (lastSynced.get(key) !== sig) {
        changed.push(item);
        signatures.set(key, sig);
      }
    }
    console.debug("🚀 ~ file: syncService.ts ~ syncToDB ~ changed", {
      changed: changed.length,
      total: all.length,
    });
    if (!changed.length) return true;
    const accessToken = AuthService.getAccessToken();
    const response = await axios.post("/sync", changed, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      // Only one sync runs at a time, so a request that never answers must not
      // block every later sync: give up and retry on the next run.
      timeout: 120 * 1000,
    });
    console.debug(
      "🚀 ~ file: syncService.ts ~ syncToDB ~ response",
      response
    );
    if (response?.data && response?.status >= 200 && response?.status < 300) {
      // Remember exactly what was sent; anything edited meanwhile has a
      // different signature and goes out on the next run.
      signatures.forEach((sig, key) => lastSynced.set(key, sig));
      saveAccepted();
      return true;
    }
    return false;
  } catch (err) {
    console.error("🚀 ~ file: syncService.js ~ syncToDB ~ err:", err);
    return false;
  }
};

export const SyncService = {
  syncToDB: async (): Promise<boolean> => {
    // Already syncing: don't start a second POST. Ask for one more run when
    // this one ends, so changes made meanwhile are not left waiting.
    if (running) {
      runAgain = true;
      return running;
    }
    running = (async () => {
      let ok = await syncChanged();
      while (runAgain) {
        runAgain = false;
        ok = await syncChanged();
      }
      return ok;
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  },
};
