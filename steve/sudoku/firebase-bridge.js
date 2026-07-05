import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, deleteDoc, onSnapshot, collection,
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Multi-tab-safe persistent cache: lets more than one open tab share offline persistence.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

let gameUnsub = null;
let scoresUnsub = null;

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
