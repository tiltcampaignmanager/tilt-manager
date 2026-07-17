// Firebase project configs. Kept out of index.html so they can be swapped per
// environment (e.g. staging vs prod) without touching app source.
//
// Note: Firebase Web API keys are project identifiers, not secrets. They ship
// to the browser in every Firebase web app. Actual access control lives in
// Firestore Security Rules + Firebase Auth, not in hiding this file.
window.FIREBASE_CONFIG = {
  tracker: {
    apiKey: "AIzaSyDjFMaP63PeJoAjJaZNQARHwer--fc0_hE",
    authDomain: "tilt-project-tracker.firebaseapp.com",
    projectId: "tilt-project-tracker",
    storageBucket: "tilt-project-tracker.firebasestorage.app",
    messagingSenderId: "339809998086",
    appId: "1:339809998086:web:14d0b5394cb336855f7a87"
  },
  hub: {
    apiKey: "AIzaSyAoRHJksz0es4lOdTGhZITzFMsXpKmlvFs",
    authDomain: "tilt-hub.firebaseapp.com",
    projectId: "tilt-hub",
    storageBucket: "tilt-hub.firebasestorage.app",
    messagingSenderId: "515235019115",
    appId: "1:515235019115:web:21e483618e62830a1af42e"
  }
};
