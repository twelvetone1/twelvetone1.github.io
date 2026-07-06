import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy,
  writeBatch, getDocs,
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
//
// One specific message is filtered out: Compose Multiplatform's own Wasm/JS interop occasionally
// throws "Cannot cast instance of Event to FocusEvent" from its internal focus-handling glue code
// (not our application code) on startup. It's been confirmed harmless — the app keeps working
// normally — and no upstream fix exists yet, so surfacing it here would just be a recurring false
// alarm during future debugging.
const KNOWN_BENIGN_ERRORS = ["Cannot cast instance of Event to FocusEvent"];

function recordCrash(text) {
  if (KNOWN_BENIGN_ERRORS.some((known) => text.includes(known))) return;
  try {
    localStorage.setItem("last_crash_error", `[${new Date().toISOString()}] ${text}`);
  } catch (_) {}
}
window.addEventListener("error", (e) => {
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
  setDoc(doc(db, "users", uid, "game", "current"), JSON.parse(json))
    .then(() => callback("ok"))
    .catch((e) => callback("error:" + e.code));
};

window.fbListenGame = (callback) => {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;
  if (gameUnsub) gameUnsub();
  gameUnsub = onSnapshot(doc(db, "users", uid, "game", "current"), (snap) => {
    callback(snap.exists() ? JSON.stringify(snap.data()) : "");
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
