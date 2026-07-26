import { auth, db, rtdb } from './firebase-config.js';
import {
  collection, query, where, getDocs, addDoc, deleteDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot, orderBy
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import {
  ref, onValue, set, onDisconnect, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js';

let friendsUnsubscribe = null;
let requestsUnsubscribe = null;
let friendsDocUnsubscribe = null;
let currentFriendsList = [];

// Initialize presence system
export function initPresence() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const statusRef = ref(rtdb, `/status/${uid}`);
  set(statusRef, { online: true, lastSeen: serverTimestamp() });
  onDisconnect(statusRef).set({ online: false, lastSeen: serverTimestamp() });
}

// Search users by username
export async function searchUsers(searchQuery) {
  if (!searchQuery || searchQuery.length < 2) return [];

  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('username', '>=', searchQuery), where('username', '<=', searchQuery + '\uf8ff'));
  const snapshot = await getDocs(q);

  const results = [];
  snapshot.forEach(doc => {
    if (doc.id !== auth.currentUser.uid) {
      results.push({ uid: doc.id, ...doc.data() });
    }
  });
  return results;
}

// Send friend request
export async function sendFriendRequest(toUid) {
  if (!auth.currentUser) {
    throw new Error('You must be signed in to add friends. Go to Chat tab to sign in.');
  }
  const myUid = auth.currentUser.uid;

  // Check if request already exists (prevent duplicates)
  const existingQ = query(
    collection(db, 'friendRequests'),
    where('from', '==', myUid),
    where('to', '==', toUid),
    where('status', '==', 'pending')
  );
  const existingSnap = await getDocs(existingQ);
  if (!existingSnap.empty) {
    throw new Error('Friend request already sent.');
  }

  // Check if already friends
  const myDoc = await getDoc(doc(db, 'users', myUid));
  const myFriends = myDoc.data()?.friends || [];
  if (myFriends.includes(toUid)) {
    throw new Error('Already friends with this user.');
  }

  const currentProfile = await getDoc(doc(db, 'users', myUid));
  const fromUsername = currentProfile.data()?.username || 'Unknown';

  await addDoc(collection(db, 'friendRequests'), {
    from: myUid,
    fromUsername: fromUsername,
    to: toUid,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
}

// Accept friend request — updates BOTH users' friend lists
export async function acceptFriendRequest(requestId, fromUid) {
  const myUid = auth.currentUser.uid;

  // Add each other as friends (arrayUnion prevents duplicates)
  await updateDoc(doc(db, 'users', myUid), { friends: arrayUnion(fromUid) });
  await updateDoc(doc(db, 'users', fromUid), { friends: arrayUnion(myUid) });

  // Delete the request
  await deleteDoc(doc(db, 'friendRequests', requestId));
}

// Decline friend request
export async function declineFriendRequest(requestId) {
  await deleteDoc(doc(db, 'friendRequests', requestId));
}

// Listen for incoming friend requests
export function listenForRequests(callback) {
  if (requestsUnsubscribe) requestsUnsubscribe();

  const q = query(
    collection(db, 'friendRequests'),
    where('to', '==', auth.currentUser.uid),
    where('status', '==', 'pending')
  );

  requestsUnsubscribe = onSnapshot(q, (snapshot) => {
    const requests = [];
    snapshot.forEach(doc => {
      requests.push({ id: doc.id, ...doc.data() });
    });
    callback(requests);
  });
}

// Real-time listener on own user doc so friend list updates instantly on both sides
export function listenForFriendsChanges() {
  if (friendsDocUnsubscribe) friendsDocUnsubscribe();

  friendsDocUnsubscribe = onSnapshot(doc(db, 'users', auth.currentUser.uid), async (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const friendUids = data.friends || [];

    const friends = [];
    for (const uid of friendUids) {
      const friendDoc = await getDoc(doc(db, 'users', uid));
      if (friendDoc.exists()) {
        friends.push({ uid, ...friendDoc.data(), online: false });
      }
    }

    // Attach online status listeners
    friends.forEach(friend => {
      const statusRef = ref(rtdb, `/status/${friend.uid}`);
      onValue(statusRef, (snap) => {
        const status = snap.val();
        friend.online = status?.online || false;
        friend.lastSeen = status?.lastSeen || null;
        renderFriendsList(currentFriendsList);
      });
    });

    currentFriendsList = friends;
    renderFriendsList(friends);
    // Notify app.js to re-render conversation list
    window.dispatchEvent(new CustomEvent('friends-updated'));
  });
}

// Get or create chat ID between two users
export function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

// Render friends list in the UI
function renderFriendsList(friends) {
  const listEl = document.getElementById('friends-list-items') || document.getElementById('msg-conv-list');
  if (!listEl) return;

  if (friends.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <i class="ri-user-add-line"></i>
        <p>No friends yet. Add some!</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = friends.map(f => `
    <div class="friend-item ${f.online ? 'online' : 'offline'}" data-uid="${f.uid}">
      <div class="friend-avatar ${f.online ? 'online' : 'offline'}">
        <i class="ri-user-fill"></i>
      </div>
      <div class="friend-details">
        <span class="friend-name">${f.username}</span>
        <span class="friend-status-text">${f.online ? 'Online' : 'Offline'}</span>
      </div>
    </div>
  `).join('');

  // Click handlers to open chat
  listEl.querySelectorAll('.friend-item').forEach(item => {
    item.addEventListener('click', () => {
      const uid = item.dataset.uid;
      const friend = friends.find(f => f.uid === uid);
      if (friend) {
        window.dispatchEvent(new CustomEvent('open-chat', { detail: friend }));
      }
    });
  });
}

// Initialize friends page
export async function initFriendsPage() {
  // Use real-time listener so both sides update when request accepted
  listenForFriendsChanges();

  listenForRequests((requests) => {
    const badge = document.getElementById('notification-badge');
    const dropdown = document.getElementById('notifications-dropdown');
    if (badge) {
      badge.textContent = requests.length;
      badge.style.display = requests.length > 0 ? 'flex' : 'none';
    }
    if (dropdown) {
      renderNotifications(requests);
    }
  });
}

function renderNotifications(requests) {
  const dropdown = document.getElementById('notifications-list');
  if (!dropdown) return;

  if (requests.length === 0) {
    dropdown.innerHTML = '<div class="empty-notif">No pending requests</div>';
    return;
  }

  dropdown.innerHTML = requests.map(r => `
    <div class="notif-item" data-id="${r.id}" data-from="${r.from}">
      <div class="notif-info">
        <i class="ri-user-add-fill"></i>
        <span><strong>${r.fromUsername}</strong> wants to be friends</span>
      </div>
      <div class="notif-actions">
        <button class="notif-accept" data-id="${r.id}" data-from="${r.from}">
          <i class="ri-check-line"></i>
        </button>
        <button class="notif-decline" data-id="${r.id}">
          <i class="ri-close-line"></i>
        </button>
      </div>
    </div>
  `).join('');

  dropdown.querySelectorAll('.notif-accept').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await acceptFriendRequest(btn.dataset.id, btn.dataset.from);
      // Friends list auto-updates via listenForFriendsChanges
    });
  });

  dropdown.querySelectorAll('.notif-decline').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await declineFriendRequest(btn.dataset.id);
    });
  });
}

// Get current friends list
export function getFriendsList() {
  return Promise.resolve(currentFriendsList);
}

// Remove friend
export async function removeFriend(friendUid) {
  const myUid = auth.currentUser.uid;
  await updateDoc(doc(db, 'users', myUid), { friends: arrayRemove(friendUid) });
  await updateDoc(doc(db, 'users', friendUid), { friends: arrayRemove(myUid) });
}

// Block user
export async function blockUser(uid) {
  const myUid = auth.currentUser.uid;
  // Remove from friends first
  await updateDoc(doc(db, 'users', myUid), {
    friends: arrayRemove(uid),
    blocked: arrayUnion(uid)
  });
  await updateDoc(doc(db, 'users', uid), { friends: arrayRemove(myUid) });
}

// Delete group (owner only)
export async function deleteGroup(groupId) {
  await deleteDoc(doc(db, 'groups', groupId));
}

// Cleanup listeners
export function cleanupFriends() {
  if (friendsUnsubscribe) friendsUnsubscribe();
  if (requestsUnsubscribe) requestsUnsubscribe();
  if (friendsDocUnsubscribe) friendsDocUnsubscribe();
}
