import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy,
  writeBatch, getDocs, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Not a secret: this identifies the Firebase project only. Access is gated entirely by
// firestore.rules + Auth, the same as any deployed Firebase web app.
const firebaseConfig = {
  apiKey: "AIzaSyCE4-l6206t-16zxnhoBqPIQHNHAZKLSQE",
  authDomain: "stevesudoku-sync.firebaseapp.com",
  projectId: "stevesudoku-sync",
  storageBucket: "stevesudoku-sync.firebasestorage.app",
  messagingSenderId: "897826855347",
  appId: "1:897826855347:web:a46b48224548a2b74d53c6",
};

// Persist any uncaught error/rejection to localStorage — survives even a crash that reloads the
// page, so it can be shown in-app on the next load without needing devtools to see it live.
function recordCrash(text) {
  try {
    localStorage.setItem("last_crash_error", `[${new Date().toISOString()}] ${text}`);
  } catch (_) {}
}
// Appended in the sync log's own format (see WebGameController.logSync and BrowserClock).
function appendSyncLog(text) {
  try {
    const stamp = new Date().toLocaleString(undefined, {month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit"});
    const entries = (localStorage.getItem("sync_debug_log") || "").split("\n").filter((l) => l.trim() !== "");
    entries.push(`[${stamp}] ${text}`);
    localStorage.setItem("sync_debug_log", entries.slice(-500).join("\n"));
  } catch (_) {}
}

// Builds before 2026-11-15 17:02 stored that same detail-less "Script error." as a crash, which
// then popped up on every load until dismissed. Clear such a leftover rather than show it.
try {
  const stored = localStorage.getItem("last_crash_error") || "";
  if (/\] error: Script error\.? at \?:\?$/.test(stored)) {
    localStorage.removeItem("last_crash_error");
    appendSyncLog("cleared an old detail-less script error left by an earlier build");
  }
} catch (_) {}

window.addEventListener("error", (e) => {
  // "Script error." with no file is all a browser reveals about an error in a script from another
  // origin -- Safari's own helpers, such as the share sheet reading the page for "Add to Home
  // Screen", raise them. Nothing here can act on it, so it goes to the sync log, not the dialog.
  if (!e.filename && String(e.message || "").startsWith("Script error")) {
    appendSyncLog("browser reported a script error from another origin (no details given)");
    return;
  }
  recordCrash(`error: ${e.message || e} at ${e.filename || "?"}:${e.lineno || "?"}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason && e.reason.message ? e.reason.message : String(e.reason);
  recordCrash(`unhandledrejection: ${reason}`);
});

window.fbGetLastCrashError = () => {
  try {
    return localStorage.getItem("last_crash_error") || "";
  } catch (_) {
    return "";
  }
};

window.fbClearLastCrashError = () => {
  try {
    localStorage.removeItem("last_crash_error");
  } catch (_) {}
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Multi-tab-safe persistent cache: lets more than one open tab share offline persistence.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

let gameUnsub = null;
let scoresUnsub = null;
let movesUnsub = null;

function movesCollection(uid) {
  return collection(db, "users", uid, "game", "current", "moves");
}

window.fbIsSignedIn = () => auth.currentUser !== null;

window.fbSignIn = (email, password, callback) => {
  signInWithEmailAndPassword(auth, email, password)
    .then(() => callback("ok"))
    .catch((e) => callback("error:" + e.code));
};

window.fbSignOut = () => {
  signOut(auth);
};

window.fbAuthReady = (callback) => {
  onAuthStateChanged(auth, (user) => callback(user !== null));
};

window.fbSaveGame = (json, callback) => {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) { callback("error:not-signed-in"); return; }
  // The server stamps updatedAt, not the device: ordering between devices must not depend on
  // two clocks agreeing. Whatever the caller put there is replaced.
  const data = { ...JSON.parse(json), updatedAt: serverTimestamp() };
  setDoc(doc(db, "users", uid, "game", "current"), data)
    .then(() => callback("ok"))
    .catch((e) => callback("error:" + e.code));
};

// Epoch millis for the server-stamped updatedAt, tolerating both shapes it arrives in: a
// Timestamp once the server has assigned one, and a plain number from a client that predates
// the change. Null -- our own write, not yet confirmed -- reads as 0, older than anything.
function updatedAtMillis(value) {
  if (value == null) return 0;
  // A client-clock stamp written by an older build can sit in the future. Left alone it would
  // outrank every server stamp until wall-clock time caught up, freezing sync.
  if (typeof value === "number") return Math.min(value, Date.now());
  if (typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

window.fbListenGame = (callback) => {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;
  if (gameUnsub) gameUnsub();
  gameUnsub = onSnapshot(doc(db, "users", uid, "game", "current"), (snap) => {
    if (!snap.exists()) { callback(""); return; }
    // Our own write echoed back before the server confirmed it: we already hold that state, and
    // the timestamp on it is not real yet, so there is nothing here to apply.
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.data();
    callback(JSON.stringify({ ...data, updatedAt: updatedAtMillis(data.updatedAt) }));
  }, (err) => console.warn("game listener error:", err));
};

// Appends new move-log entries as small individual documents (one Firestore write per move,
// batched together) rather than growing one ever-larger field on the game document.
window.fbAppendMoves = (movesJson, callback) => {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) { callback("error:not-signed-in"); return; }
  const moves = JSON.parse(movesJson);
  const batch = writeBatch(db);
  const collectionRef = movesCollection(uid);
  for (const move of moves) {
    batch.set(doc(collectionRef, String(move.seq)), move);
  }
  batch.commit().then(() => callback("ok")).catch((e) => callback("error:" + e.code));
};

// Atomically replaces the entire move log — used both to recover from a local history branch
// and to apply a checkpoint compaction (old moves folded into baseBoardState).
window.fbReplaceMoves = (movesJson, callback) => {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) { callback("error:not-signed-in"); return; }
  const moves = JSON.parse(movesJson);
  const collectionRef = movesCollection(uid);
  getDocs(collectionRef).then((existing) => {
    const batch = writeBatch(db);
    existing.forEach((d) => batch.delete(d.ref));
    for (const move of moves) {
      batch.set(doc(collectionRef, String(move.seq)), move);
    }
    return batch.commit();
  }).then(() => callback("ok")).catch((e) => callback("error:" + e.code));
};

// Emits the full move log (ordered by sequence) every time it changes. Bounded by periodic
// checkpointing, so listening to the whole subcollection — rather than paging — stays cheap.
window.fbListenMoves = (callback) => {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;
  if (movesUnsub) movesUnsub();
  const q = query(movesCollection(uid), orderBy("seq", "asc"));
  movesUnsub = onSnapshot(q, (snap) => {
    callback(JSON.stringify(snap.docs.map((d) => d.data())));
  }, (err) => console.warn("moves listener error:", err));
};

window.fbSaveScore = (json, callback) => {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) { callback("error:not-signed-in"); return; }
  const score = JSON.parse(json);
  setDoc(doc(db, "users", uid, "scores", score.id), score)
    .then(() => callback("ok"))
    .catch((e) => callback("error:" + e.code));
};

window.fbDeleteScore = (id, callback) => {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) { callback("error:not-signed-in"); return; }
  deleteDoc(doc(db, "users", uid, "scores", id))
    .then(() => callback("ok"))
    .catch((e) => callback("error:" + e.code));
};

window.fbListenScores = (callback) => {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;
  if (scoresUnsub) scoresUnsub();
  scoresUnsub = onSnapshot(collection(db, "users", uid, "scores"), (snap) => {
    callback(JSON.stringify(snap.docs.map((d) => d.data())));
  }, (err) => console.warn("scores listener error:", err));
};
