// Stands in for firebase-bridge.js under ?nofb: the same window.fb* surface, behaving as a
// signed-out client, with no Firebase SDK, no auth iframe and no network.
window.fbIsSignedIn = () => false;
window.fbSignIn = (email, password, callback) => callback("error:stubbed");
window.fbSignOut = () => {};
window.fbAuthReady = (callback) => { setTimeout(() => callback(false), 0); };
window.fbSaveGame = (json, callback) => callback("error:not-signed-in");
window.fbListenGame = () => {};
window.fbAppendMoves = (movesJson, callback) => callback("error:not-signed-in");
window.fbReplaceMoves = (movesJson, callback) => callback("error:not-signed-in");
window.fbListenMoves = () => {};
window.fbSaveScore = (json, callback) => callback("error:not-signed-in");
window.fbDeleteScore = (id, callback) => callback("error:not-signed-in");
window.fbListenScores = () => {};
window.fbGetLastCrashError = () => "";
window.fbClearLastCrashError = () => {};
