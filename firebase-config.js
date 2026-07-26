import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js';

// ============================================================
// IMPORTANT: Replace with YOUR Firebase project configuration
// Go to https://console.firebase.google.com → Your Project → Project Settings → General → Your apps → Config
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCZ6qjP5-tGpoGjomptbLo3Z-bcDLds2Ag",
  authDomain: "calling-app-66fcc.firebaseapp.com",
  databaseURL: "https://calling-app-66fcc-default-rtdb.firebaseio.com",
  projectId: "calling-app-66fcc",
  storageBucket: "calling-app-66fcc.firebasestorage.app",
  messagingSenderId: "23340534871",
  appId: "1:23340534871:web:3fa797b63e429e08382712"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const rtdb = getDatabase(firebaseApp);

export { firebaseApp, auth, db, rtdb, onAuthStateChanged };
