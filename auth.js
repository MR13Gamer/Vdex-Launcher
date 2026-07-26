import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
import {
  doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';

const googleProvider = new GoogleAuthProvider();

// DOM elements
const authScreen = document.getElementById('auth-screen');
const signInForm = document.getElementById('signin-form');
const registerForm = document.getElementById('register-form');
const usernamePrompt = document.getElementById('username-prompt');
const continueForm = document.getElementById('continue-form');
const appContainer = document.getElementById('app-container');

// Hide all auth forms initially while checking saved session
signInForm.classList.add('hidden');

// Switch between sign-in and register
document.getElementById('show-register').addEventListener('click', (e) => {
  e.preventDefault();
  signInForm.classList.add('hidden');
  continueForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
});

document.getElementById('show-signin').addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.classList.add('hidden');
  continueForm.classList.add('hidden');
  signInForm.classList.remove('hidden');
});

// "Continue as" button — Firebase session is still active, just proceed
document.getElementById('continue-btn').addEventListener('click', async () => {
  const user = auth.currentUser;
  if (user) {
    // Already signed in, just show the app
    const profile = await getCurrentUserProfile();
    if (profile) {
      showApp(user);
    } else {
      // Profile missing, show sign in
      continueForm.classList.add('hidden');
      signInForm.classList.remove('hidden');
    }
  } else {
    // Session expired, show sign in
    continueForm.classList.add('hidden');
    clearAccountInfo();
    signInForm.classList.remove('hidden');
  }
});

// "Use a different account" link
document.getElementById('switch-account-btn').addEventListener('click', async (e) => {
  e.preventDefault();
  // Sign out current session
  if (auth.currentUser) {
    await signOut(auth);
  }
  clearAccountInfo();
  continueForm.classList.add('hidden');
  signInForm.classList.remove('hidden');
});

// Check if username is already taken
async function isUsernameTaken(username, excludeUid) {
  const q = query(collection(db, 'users'), where('username', '==', username));
  const snapshot = await getDocs(q);
  let taken = false;
  snapshot.forEach(doc => {
    if (doc.id !== excludeUid) taken = true;
  });
  return taken;
}

// Sign In
document.getElementById('signin-btn').addEventListener('click', async () => {
  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  const errorEl = document.getElementById('signin-error');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Please fill in all fields.';
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errorEl.textContent = getErrorMessage(err.code);
  }
});

// Register
document.getElementById('register-btn').addEventListener('click', async () => {
  const username = document.getElementById('register-username').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-confirm').value;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';

  if (!username || !email || !password || !confirm) {
    errorEl.textContent = 'Please fill in all fields.';
    return;
  }
  if (password !== confirm) {
    errorEl.textContent = 'Passwords do not match.';
    return;
  }
  if (username.length < 3 || username.length > 20) {
    errorEl.textContent = 'Username must be 3-20 characters.';
    return;
  }

  // Check uniqueness
  if (await isUsernameTaken(username, null)) {
    errorEl.textContent = 'This username is already taken.';
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, 'users', cred.user.uid), {
      username: username,
      email: email,
      friends: [],
      createdAt: new Date().toISOString(),
      lastUsernameChange: new Date().toISOString()
    });
  } catch (err) {
    errorEl.textContent = getErrorMessage(err.code);
  }
});

// Google Sign In
document.getElementById('google-signin-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('signin-error');
  errorEl.textContent = '';
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const userDoc = await getDoc(doc(db, 'users', result.user.uid));
    if (!userDoc.exists()) {
      signInForm.classList.add('hidden');
      registerForm.classList.add('hidden');
      usernamePrompt.classList.remove('hidden');
      window._pendingGoogleUser = result.user;
    }
  } catch (err) {
    console.error('Google sign-in error:', err.code, err.message);
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
      errorEl.textContent = 'Popup was blocked or closed. Please try again.';
    } else if (err.code === 'auth/unauthorized-domain') {
      errorEl.textContent = 'This domain is not authorized. Add "localhost" to Authorized domains in Firebase Console > Authentication > Settings.';
    } else {
      errorEl.textContent = getErrorMessage(err.code);
    }
  }
});

// Username prompt for Google users
document.getElementById('username-submit-btn').addEventListener('click', async () => {
  const username = document.getElementById('prompt-username').value.trim();
  const errorEl = document.getElementById('username-error');
  errorEl.textContent = '';

  if (!username || username.length < 3 || username.length > 20) {
    errorEl.textContent = 'Username must be 3-20 characters.';
    return;
  }

  if (await isUsernameTaken(username, null)) {
    errorEl.textContent = 'This username is already taken.';
    return;
  }

  const user = window._pendingGoogleUser || auth.currentUser;
  if (!user) return;

  try {
    await setDoc(doc(db, 'users', user.uid), {
      username: username,
      email: user.email,
      friends: [],
      createdAt: new Date().toISOString(),
      lastUsernameChange: new Date().toISOString()
    });
    usernamePrompt.classList.add('hidden');
    showApp(user);
  } catch (err) {
    errorEl.textContent = 'Failed to save username. Try again.';
  }
});

// Change username (once per 7 days, must be unique)
export async function changeUsername(newUsername) {
  if (!auth.currentUser) return { success: false, error: 'Not logged in.' };
  if (!newUsername || newUsername.length < 3 || newUsername.length > 20) {
    return { success: false, error: 'Username must be 3-20 characters.' };
  }

  const uid = auth.currentUser.uid;
  const profile = await getDoc(doc(db, 'users', uid));
  if (!profile.exists()) return { success: false, error: 'Profile not found.' };

  const data = profile.data();

  // Check 7-day cooldown
  if (data.lastUsernameChange) {
    const lastChange = new Date(data.lastUsernameChange);
    const now = new Date();
    const daysSince = (now - lastChange) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) {
      const daysLeft = Math.ceil(7 - daysSince);
      return { success: false, error: `You can change your username in ${daysLeft} day${daysLeft > 1 ? 's' : ''}.` };
    }
  }

  // Check uniqueness
  if (await isUsernameTaken(newUsername, uid)) {
    return { success: false, error: 'This username is already taken.' };
  }

  await updateDoc(doc(db, 'users', uid), {
    username: newUsername,
    lastUsernameChange: new Date().toISOString()
  });

  return { success: true };
}

// Sign Out
export async function handleSignOut() {
  clearAccountInfo();
  // Clear saved chat auth so it doesn't auto-sign-in next launch
  if (window.electronAPI?.setSetting) {
    window.electronAPI.setSetting('chatAuth', null);
  }
  await signOut(auth);
}

// Show main app (app is always visible now, this just fires the auth event)
function showApp(user) {
  authScreen.classList.add('hidden');
  appContainer.classList.remove('hidden');
  window.currentUser = user;
  // Hide chat sign-in gate, show messenger
  const gate = document.getElementById('chat-signin-gate');
  const layout = document.querySelector('.messenger-layout');
  if (gate) gate.style.display = 'none';
  if (layout) layout.style.display = '';
  window.dispatchEvent(new CustomEvent('user-authenticated', { detail: user }));
}

// Sign-in is now handled inside the Chat tab — showAuth is a no-op
async function showAuth() {
  // Don't show auth screen — sign-in lives inside Chat tab
  window.currentUser = null;
}

// Save account info for "Continue as" on next launch
function saveAccountInfo(username, email) {
  localStorage.setItem('vdex-last-account', JSON.stringify({ username, email }));
}

// Clear saved account (on explicit sign out)
function clearAccountInfo() {
  localStorage.removeItem('vdex-last-account');
}

function getErrorMessage(code) {
  const messages = {
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/popup-closed-by-user': 'Sign-in popup was closed.',
    'auth/network-request-failed': 'Network error. Check your connection.'
  };
  return messages[code] || 'An error occurred. Please try again.';
}

export async function getCurrentUserProfile() {
  if (!auth.currentUser) return null;
  const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
  if (userDoc.exists()) {
    const data = userDoc.data();
    // Save for "Continue as" on next launch
    saveAccountInfo(data.username, data.email);
    return { uid: auth.currentUser.uid, ...data };
  }
  return null;
}

export { auth, showAuth, showApp };
