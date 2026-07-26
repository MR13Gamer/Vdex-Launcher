import { auth, db, onAuthStateChanged } from './firebase-config.js';
import { handleSignOut, getCurrentUserProfile, showApp, showAuth, changeUsername } from './auth.js';
import { initPresence, initFriendsPage, searchUsers, sendFriendRequest, cleanupFriends, getFriendsList, removeFriend, blockUser, deleteGroup } from './friends.js';
import {
  collection, addDoc, getDocs, getDoc, deleteDoc, doc, query, orderBy, onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import { openChat, sendMessage, startCall, acceptCall, declineCall, endCall, toggleMute, cleanupChat, setCurrentUsername, initEmojiPicker, toggleEmojiPicker, showCallBanner, hideCallBanner, initCallListener, startVideoCall, sendFileMessage, createGroup, sendGroupMessage, sendTypingIndicator, replyToMessage, editMessage, deleteMessage, reactToMessage, inviteToGroup, startGroupCall, joinGroupCall, endGroupCall, listenForGroupCallInvites, isGroupCall, minimizeGroupCall, restoreGroupCall } from './chat.js';
import { searchMods, renderModResults, closeModDetail, refreshDownloadedMods, loadRecommendedMods, setLoaderFilter, setGameVersionFilter, populateVersionDropdown, setDetailLoaderFilter, setDetailGameVersionFilter, filterDetailVersions } from './mods.js';
import { initMinecraft, handleAction, setSelectedVersion, filterVersions, cancelAction, isMcRunning, getSelectedVersion, getSelectedLoader } from './minecraft.js';
import { initServers } from './servers.js';
import { initClient } from './client.js';
import { initInstances } from './instances.js';

let currentProfile = null;

// =================== AUTH STATE ===================
// Skip auth screen at startup — show app directly.
// Google sign-in only triggers when user clicks Chat tab.

let appInitialized = false;

let chatAuthRestoreAttempted = false;

onAuthStateChanged(auth, async (user) => {
  // Always show the app directly — no auth screen at startup
  const authScreen = document.getElementById('auth-screen');
  const appContainer = document.getElementById('app-container');
  if (authScreen) authScreen.classList.add('hidden');
  if (appContainer) appContainer.classList.remove('hidden');

  // Init non-auth features only once
  if (!appInitialized) {
    appInitialized = true;
    initMinecraft();
    refreshDownloadedMods();
    loadSavedSettings();
    initServers();
    initClient();
    initInstances();
    loadRecommendedMods('popular');
    loadMinecraftNews();
    restoreMcSettings();
  }

  if (user) {
    const profile = await getCurrentUserProfile();
    if (profile) {
      // Fire user-authenticated for chat/friends init
      window.currentUser = user;
      window.__currentUid = user.uid;
      window.dispatchEvent(new CustomEvent('user-authenticated', { detail: user }));

      // If on chat tab, switch from gate to messenger
      const gate = document.getElementById('chat-signin-gate');
      const layout = document.querySelector('.messenger-layout');
      if (gate) gate.style.display = 'none';
      if (layout) layout.style.display = '';
    }
  } else {
    // Try to restore saved chat auth (once per launch)
    if (!chatAuthRestoreAttempted && window.electronAPI) {
      chatAuthRestoreAttempted = true;
      try {
        const saved = await window.electronAPI.getSetting('chatAuth', null);
        if (saved && saved.method === 'email' && saved.email && saved.password) {
          const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js');
          await signInWithEmailAndPassword(auth, saved.email, saved.password);
          // onAuthStateChanged will fire again with the user
          return;
        }
      } catch (e) {
        console.warn('Chat auth restore failed:', e.message);
        // Clear invalid saved auth
        window.electronAPI.setSetting('chatAuth', null);
      }
    }

    // Show sign-in gate on chat tab
    const gate = document.getElementById('chat-signin-gate');
    const layout = document.querySelector('.messenger-layout');
    if (gate) gate.style.display = 'flex';
    if (layout) layout.style.display = 'none';

    cleanupFriends();
    cleanupChat();
  }
});

// When user is authenticated, init everything
window.addEventListener('user-authenticated', async (e) => {
  currentProfile = await getCurrentUserProfile();
  if (currentProfile) {
    document.getElementById('home-username').textContent = currentProfile.username;
    document.getElementById('home-display-username').textContent = currentProfile.username;
    document.getElementById('settings-username').textContent = currentProfile.username;
    document.getElementById('settings-email').textContent = currentProfile.email;
  }
  setCurrentUsername(currentProfile.username);
  initPresence();
  initFriendsPage();
  initCallListener();
  listenForGroupCallInvites();
  refreshDownloadedMods();
  initMinecraft();
  initEmojiPicker();
  loadSavedSettings();
  initServers();
  loadRecommendedMods('popular');
  renderGroupsList(); // Load user's groups

  // Populate messenger conversation list from friends
  setTimeout(async () => {
    try {
      const friends = await getFriendsList();
      renderConversationList(friends);
    } catch (e) {}
  }, 2000);

  // Re-render when friends list changes
  window.addEventListener('friends-updated', async () => {
    try {
      const friends = await getFriendsList();
      renderConversationList(friends);
    } catch (e) {}
  });
});

// =================== NAVIGATION ===================
const navItems = document.querySelectorAll('.nav-item[data-page]');
const pages = document.querySelectorAll('.page');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetPage = item.dataset.page;
    if (!targetPage) return;
    navItems.forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');
    pages.forEach(page => page.classList.remove('active'));
    const pageEl = document.getElementById(`page-${targetPage}`);
    if (pageEl) pageEl.classList.add('active');

    // Friends/messenger: show sign-in gate or messenger based on auth state
    if (targetPage === 'friends') {
      const layout = document.querySelector('.messenger-layout');
      const gate = document.getElementById('chat-signin-gate');
      if (!auth.currentUser) {
        if (gate) gate.style.display = 'flex';
        if (layout) layout.style.display = 'none';
      } else {
        if (gate) gate.style.display = 'none';
        if (layout) layout.style.display = '';
      }
    }
  });
});

// Folder button: open app directory directly
document.getElementById('folder-nav-btn')?.addEventListener('click', async () => {
  try {
    await window.electronAPI.openDirectory('');
  } catch (e) {
    console.error('Failed to open directory:', e);
  }
});

// =================== SIGN OUT ===================
document.getElementById('sign-out-btn').addEventListener('click', async () => {
  await handleSignOut();
});

// =================== USERNAME EDIT ===================
document.getElementById('edit-username-btn').addEventListener('click', () => {
  document.getElementById('username-edit-area').classList.remove('hidden');
  document.getElementById('new-username-input').value = '';
  document.getElementById('username-edit-error').textContent = '';
  document.getElementById('new-username-input').focus();
});

document.getElementById('cancel-username-btn').addEventListener('click', () => {
  document.getElementById('username-edit-area').classList.add('hidden');
});

document.getElementById('save-username-btn').addEventListener('click', async () => {
  const newName = document.getElementById('new-username-input').value.trim();
  const errorEl = document.getElementById('username-edit-error');
  errorEl.textContent = '';
  if (!newName) { errorEl.textContent = 'Enter a username.'; return; }
  const result = await changeUsername(newName);
  if (result.success) {
    document.getElementById('home-username').textContent = newName;
    document.getElementById('home-display-username').textContent = newName;
    document.getElementById('settings-username').textContent = newName;
    document.getElementById('username-edit-area').classList.add('hidden');
    currentProfile.username = newName;
  } else {
    errorEl.textContent = result.error;
  }
});

// =================== MINECRAFT ===================
// Restore saved username, version, loader, login mode on load
async function restoreMcSettings() {
  try {
    const s = await window.electronAPI.getSettings();
    // Restore login mode
    if (s.mcLoginMode) {
      const btn = document.querySelector(`.mc-login-btn[data-login="${s.mcLoginMode}"]`);
      if (btn) btn.click();
    }
    // Restore username in offline mode
    if (s.mcUsername) {
      const usernameInput = document.getElementById('mc-offline-username');
      if (usernameInput) usernameInput.value = s.mcUsername;
    }
    // Restore version (after versions have loaded)
    if (s.mcVersion) {
      const versionSelect = document.getElementById('mc-version-select');
      if (versionSelect) {
        // Wait for options to be populated
        const checkAndSet = () => {
          const opt = versionSelect.querySelector(`option[value="${s.mcVersion}"]`);
          if (opt) {
            versionSelect.value = s.mcVersion;
            setSelectedVersion(s.mcVersion);
          }
        };
        setTimeout(checkAndSet, 1500);
        setTimeout(checkAndSet, 3000);
      }
    }
    // Restore loader
    if (s.mcLoader) {
      setTimeout(() => {
        const loaderBtn = document.querySelector(`.loader-btn[data-loader="${s.mcLoader}"]`);
        if (loaderBtn && !loaderBtn.classList.contains('loader-unavailable')) {
          loaderBtn.click();
        }
      }, 2000);
    }
    // Restore Microsoft auth state
    if (s.mcLoginMode === 'microsoft') {
      try {
        const authState = await window.electronAPI.msAuthCheck();
        if (authState.loggedIn) {
          const statusEl = document.getElementById('mc-login-status');
          const inputArea = document.getElementById('mc-login-input-area');
          if (statusEl) { statusEl.textContent = `Logged in as ${authState.username}`; statusEl.className = 'mc-login-status success'; }
          if (inputArea) inputArea.innerHTML = `<div class="ms-auth-info"><i class="ri-microsoft-fill"></i> <strong>${authState.username}</strong> <button class="mc-login-btn" id="mc-ms-logout-btn"><i class="ri-logout-box-line"></i> Logout</button></div>`;
          document.getElementById('mc-ms-logout-btn')?.addEventListener('click', async () => {
            await window.electronAPI.msAuthLogout();
            const statusEl = document.getElementById('mc-login-status');
            if (statusEl) { statusEl.textContent = 'Logged out'; statusEl.className = 'mc-login-status'; }
            if (inputArea) inputArea.innerHTML = '<button class="mc-login-btn" id="mc-microsoft-login-btn"><i class="ri-login-box-line"></i> Sign in with Microsoft</button>';
            setupMsLoginBtn();
          });
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error('Failed to restore MC settings:', e);
  }
}

// Save username on button click
document.getElementById('mc-save-username-btn')?.addEventListener('click', async () => {
  const usernameInput = document.getElementById('mc-offline-username');
  if (usernameInput && usernameInput.value.trim()) {
    await window.electronAPI.setSetting('mcUsername', usernameInput.value.trim());
    const btn = document.getElementById('mc-save-username-btn');
    if (btn) { btn.innerHTML = '<i class="ri-check-line"></i> Saved!'; setTimeout(() => { btn.innerHTML = '<i class="ri-save-line"></i> Save'; }, 2000); }
  }
});

// Also save username on enter key
document.getElementById('mc-offline-username')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('mc-save-username-btn')?.click();
});

document.getElementById('mc-version-select')?.addEventListener('change', (e) => {
  setSelectedVersion(e.target.value);
  window.electronAPI.setSetting('mcVersion', e.target.value);
});

document.querySelectorAll('.vfilter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vfilter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterVersions(btn.dataset.filter);
  });
});

document.getElementById('mc-action-btn')?.addEventListener('click', () => {
  const username = window.getMcUsername ? window.getMcUsername() : (currentProfile?.username || 'VDeXPlayer');
  handleAction(username);
});

document.getElementById('mc-cancel-btn')?.addEventListener('click', () => {
  cancelAction();
});

// =================== MESSENGER: CONVERSATION LIST ===================
let currentConvFriends = [];
let activeConvTab = 'all';
let currentGroupId = null;

function renderConversationList(friends) {
  currentConvFriends = friends || [];
  const container = document.getElementById('msg-conv-list');
  if (!container) return;

  const filtered = activeConvTab === 'groups' ? [] : currentConvFriends;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="msg-conv-empty">
        <i class="ri-chat-3-line"></i>
        <p>No conversations yet</p>
        <span>Add friends to start chatting</span>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(f => `
    <div class="msg-conv-item" data-uid="${f.uid}">
      <div class="msg-conv-avatar ${f.online ? 'online' : ''}">
        <i class="ri-user-fill"></i>
      </div>
      <div class="msg-conv-info">
        <div class="msg-conv-name">${escapeHtml(f.username)}</div>
        <div class="msg-conv-preview">${f.online ? 'Online' : 'Offline'}</div>
      </div>
      <div class="msg-conv-actions">
        <button class="msg-conv-action-btn remove-friend-btn" data-uid="${f.uid}" title="Remove Friend"><i class="ri-user-unfollow-line"></i></button>
        <button class="msg-conv-action-btn block-friend-btn" data-uid="${f.uid}" title="Block"><i class="ri-forbid-line"></i></button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.msg-conv-item').forEach(item => {
    item.addEventListener('click', () => {
      const uid = item.dataset.uid;
      const friend = currentConvFriends.find(f => f.uid === uid);
      if (friend) {
        container.querySelectorAll('.msg-conv-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        openFriendChat(friend);
      }
    });
  });

  // Remove friend buttons
  container.querySelectorAll('.remove-friend-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Remove this friend?')) return;
      await removeFriend(btn.dataset.uid);
    });
  });

  // Block friend buttons
  container.querySelectorAll('.block-friend-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Block this user? They will be removed from your friends.')) return;
      await blockUser(btn.dataset.uid);
    });
  });
}

function openFriendChat(friend) {
  // Show chat area, hide empty state
  const empty = document.getElementById('msg-chat-empty');
  const active = document.getElementById('msg-chat-active');
  if (empty) empty.classList.add('hidden');
  if (active) { active.classList.remove('hidden'); active.style.display = 'flex'; }

  // Update header
  document.getElementById('chat-friend-name').textContent = friend.username;
  const statusEl = document.getElementById('chat-friend-status');
  if (statusEl) {
    statusEl.textContent = friend.online ? 'Online' : 'Offline';
    statusEl.className = `msg-status ${friend.online ? 'online' : 'offline'}`;
  }

  // Hide add-to-group btn for DMs, show DM call buttons, hide group call btn
  const addBtn = document.getElementById('msg-add-to-group-btn');
  if (addBtn) addBtn.style.display = 'none';
  const groupCallBtn = document.getElementById('group-call-btn');
  const voiceCallBtn = document.getElementById('voice-call-btn');
  const videoCallBtn = document.getElementById('msg-video-call-btn');
  if (groupCallBtn) groupCallBtn.style.display = 'none';
  if (voiceCallBtn) voiceCallBtn.style.display = '';
  if (videoCallBtn) videoCallBtn.style.display = '';
  window.__currentGroupForCall = null;
  currentGroupId = null; // Clear group context for DM

  // Hide group members panel + toggle for DMs
  const membersPanel = document.getElementById('group-members-panel');
  const membersToggle = document.getElementById('group-members-toggle');
  if (membersPanel) membersPanel.classList.add('hidden');
  if (membersToggle) membersToggle.style.display = 'none';
  document.querySelector('.msg-chat-area')?.classList.remove('has-members-panel');

  // Mobile: slide chat in
  document.querySelector('.msg-chat-area')?.classList.add('slide-in');
  document.querySelector('.msg-sidebar')?.classList.add('slide-out');

  // Open chat (loads messages)
  openChat(friend);
}

// Messenger tabs
document.querySelectorAll('.msg-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.msg-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeConvTab = tab.dataset.tab;

    const convList = document.getElementById('msg-conv-list');
    const groupsList = document.getElementById('msg-groups-list');

    if (activeConvTab === 'groups') {
      convList?.classList.add('hidden');
      groupsList?.classList.remove('hidden');
      renderGroupsList(); // Load groups from Firestore
    } else {
      convList?.classList.remove('hidden');
      groupsList?.classList.add('hidden');
      renderConversationList(currentConvFriends);
    }
  });
});

// Back button (mobile)
document.getElementById('msg-back-btn')?.addEventListener('click', () => {
  document.querySelector('.msg-chat-area')?.classList.remove('slide-in');
  document.querySelector('.msg-sidebar')?.classList.remove('slide-out');
});

// =================== FRIENDS: ADD FRIEND MODAL ===================
const addFriendModal = document.getElementById('add-friend-modal');
document.getElementById('add-friend-btn')?.addEventListener('click', () => {
  addFriendModal.classList.remove('hidden');
  document.getElementById('friend-search-input').value = '';
  document.getElementById('friend-search-results').innerHTML = '';
  document.getElementById('friend-search-input').focus();
});

document.getElementById('close-add-friend')?.addEventListener('click', () => {
  addFriendModal.classList.add('hidden');
});

addFriendModal?.addEventListener('click', (e) => {
  if (e.target === addFriendModal) addFriendModal.classList.add('hidden');
});

// Friend search with debounce
let friendSearchTimeout;
document.getElementById('friend-search-input')?.addEventListener('input', (e) => {
  clearTimeout(friendSearchTimeout);
  friendSearchTimeout = setTimeout(async () => {
    const query = e.target.value.trim();
    const resultsEl = document.getElementById('friend-search-results');
    if (query.length < 2) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<div class="loading-spinner"><i class="ri-loader-4-line"></i></div>';
    const results = await searchUsers(query);
    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="empty-state small"><p>No users found</p></div>';
      return;
    }
    resultsEl.innerHTML = results.map(u => `
      <div class="search-result-item">
        <span>${escapeHtml(u.username)}</span>
        <button class="send-request-btn" data-uid="${u.uid}">Send Request</button>
      </div>
    `).join('');
    resultsEl.querySelectorAll('.send-request-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Sending...';
        try {
          await sendFriendRequest(btn.dataset.uid);
          btn.textContent = 'Sent!';
          btn.style.background = '#4caf50';
        } catch (err) {
          btn.textContent = err.message || 'Failed';
          btn.style.background = '#f44336';
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = 'Send Request';
            btn.style.background = '';
          }, 3000);
        }
      });
    });
  }, 400);
});

// =================== FRIENDS: NOTIFICATIONS ===================
const notifDropdown = document.getElementById('notifications-dropdown');
document.getElementById('notifications-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  notifDropdown?.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  notifDropdown?.classList.add('hidden');
});

notifDropdown?.addEventListener('click', (e) => {
  e.stopPropagation();
});

// =================== CREATE GROUP ===================
const createGroupModal = document.getElementById('create-group-modal');
document.getElementById('create-group-btn')?.addEventListener('click', () => {
  createGroupModal?.classList.remove('hidden');
  const nameInput = document.getElementById('group-name-input');
  if (nameInput) { nameInput.value = ''; nameInput.focus(); }
});

document.getElementById('close-create-group')?.addEventListener('click', () => {
  createGroupModal?.classList.add('hidden');
});

createGroupModal?.addEventListener('click', (e) => {
  if (e.target === createGroupModal) createGroupModal.classList.add('hidden');
});

document.getElementById('create-group-submit')?.addEventListener('click', async () => {
  const name = document.getElementById('group-name-input')?.value.trim();
  if (!name) return;
  const btn = document.getElementById('create-group-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
  const groupId = await createGroup(name, []);
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ri-group-line"></i> Create Group'; }
  if (groupId) {
    createGroupModal?.classList.add('hidden');
    // Refresh groups list
    renderGroupsList();
  } else {
    alert('Failed to create group. Check your connection.');
  }
});

let groupsUnsubscribe = null;

async function renderGroupsList() {
  const container = document.getElementById('msg-groups-list');
  if (!container) return;

  try {
    // Import Firestore functions
    const { collection, query, where, onSnapshot } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js');
    const { db, auth: fbAuth } = await import('./firebase-config.js');

    if (!fbAuth.currentUser) return;

    // Unsubscribe from previous listener
    if (groupsUnsubscribe) groupsUnsubscribe();

    // Use onSnapshot for REAL-TIME updates — invited members see groups instantly
    const groupsRef = collection(db, 'groups');
    const q = query(groupsRef, where('members', 'array-contains', fbAuth.currentUser.uid));

    groupsUnsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        container.innerHTML = `
          <div class="msg-conv-empty">
            <i class="ri-group-line"></i>
            <p>No groups yet</p>
            <span>Create a group to chat with multiple friends</span>
          </div>`;
        return;
      }

      const groups = [];
      snapshot.forEach(doc => {
        groups.push({ id: doc.id, ...doc.data() });
      });

      const myUid = fbAuth.currentUser?.uid;
      container.innerHTML = groups.map(g => `
        <div class="msg-conv-item group-item" data-group-id="${g.id}">
          <div class="msg-conv-avatar group">
            <i class="ri-group-fill"></i>
          </div>
          <div class="msg-conv-info">
            <div class="msg-conv-name">${escapeHtml(g.name)}</div>
            <div class="msg-conv-preview">${g.members?.length || 1} members</div>
          </div>
          ${g.owner === myUid ? `<button class="msg-conv-action-btn delete-group-btn" data-group-id="${g.id}" title="Delete Group"><i class="ri-delete-bin-line"></i></button>` : ''}
        </div>
      `).join('');

      container.querySelectorAll('.group-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.delete-group-btn')) return;
          const groupId = item.dataset.groupId;
          const group = groups.find(g => g.id === groupId);
          if (group) {
            currentGroupId = groupId;
            openGroupChat(group);
          }
        });
      });

      // Delete group buttons
      container.querySelectorAll('.delete-group-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this group? This cannot be undone.')) return;
          await deleteGroup(btn.dataset.groupId);
        });
      });
    }, (error) => {
      console.error('Groups listener error:', error);
      container.innerHTML = `
        <div class="msg-conv-empty">
          <i class="ri-error-warning-line"></i>
          <p>Failed to load groups</p>
        </div>`;
    });
  } catch (e) {
    console.error('Failed to load groups:', e);
    container.innerHTML = `
      <div class="msg-conv-empty">
        <i class="ri-error-warning-line"></i>
        <p>Failed to load groups</p>
      </div>`;
  }
}

function openGroupChat(group) {
  const empty = document.getElementById('msg-chat-empty');
  const active = document.getElementById('msg-chat-active');
  if (empty) empty.classList.add('hidden');
  if (active) { active.classList.remove('hidden'); active.style.display = 'flex'; }

  document.getElementById('chat-friend-name').textContent = group.name;
  const statusEl = document.getElementById('chat-friend-status');
  if (statusEl) {
    statusEl.textContent = `${group.members?.length || 1} members`;
    statusEl.className = 'msg-status online';
  }

  // Show add-to-group button for group owner
  const addBtn = document.getElementById('msg-add-to-group-btn');
  if (addBtn) {
    addBtn.style.display = (group.owner === auth.currentUser?.uid) ? '' : 'none';
  }

  // Show group call button, hide 1-on-1 call buttons
  const groupCallBtn = document.getElementById('group-call-btn');
  const voiceCallBtn = document.getElementById('voice-call-btn');
  const videoCallBtn = document.getElementById('msg-video-call-btn');
  if (groupCallBtn) groupCallBtn.style.display = '';
  if (voiceCallBtn) voiceCallBtn.style.display = 'none';
  if (videoCallBtn) videoCallBtn.style.display = 'none';

  // Store current group reference for group call
  window.__currentGroupForCall = { id: group.id, name: group.name, members: group.members };

  // Show group members toggle + panel
  const membersToggle = document.getElementById('group-members-toggle');
  if (membersToggle) membersToggle.style.display = '';
  showGroupMembersPanel(group);

  // Mobile slide
  document.querySelector('.msg-chat-area')?.classList.add('slide-in');
  document.querySelector('.msg-sidebar')?.classList.add('slide-out');

  // Load group messages
  import('./chat.js').then(mod => {
    mod.loadGroupMessages(group.id);
  });
}

// =================== GROUP MEMBERS PANEL ===================
async function showGroupMembersPanel(group) {
  const panel = document.getElementById('group-members-panel');
  const list = document.getElementById('gmp-list');
  const chatArea = document.querySelector('.msg-chat-area');
  if (!panel || !list) return;

  panel.classList.remove('hidden');
  chatArea?.classList.add('has-members-panel');

  const memberUids = group.members || [];
  const ownerUid = group.owner;

  // Import RTDB once
  const { ref: rtdbRef, get: rtdbGet } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js');
  const { rtdb } = await import('./firebase-config.js');

  let onlineHtml = '';
  let offlineHtml = '';

  for (const uid of memberUids) {
    try {
      const userDoc = await getDoc(doc(db, 'users', uid));
      const username = userDoc.exists() ? userDoc.data().username : 'Unknown';
      const isOwner = uid === ownerUid;

      let online = false;
      try {
        const presSnap = await rtdbGet(rtdbRef(rtdb, `/presence/${uid}`));
        online = presSnap.exists() && presSnap.val()?.online === true;
      } catch (e) {}

      const memberHtml = `
        <div class="gmp-member">
          <div class="gmp-member-avatar ${isOwner ? 'owner' : ''} ${online ? 'online' : ''}">
            <i class="${isOwner ? 'ri-vip-crown-fill' : 'ri-user-fill'}"></i>
          </div>
          <div class="gmp-member-info">
            <div class="gmp-member-name">${username}</div>
            ${isOwner ? '<div class="gmp-member-role">Owner</div>' : ''}
          </div>
        </div>`;
      if (online) onlineHtml += memberHtml; else offlineHtml += memberHtml;
    } catch (e) {
      offlineHtml += `
        <div class="gmp-member">
          <div class="gmp-member-avatar"><i class="ri-user-fill"></i></div>
          <div class="gmp-member-info"><div class="gmp-member-name">Unknown</div></div>
        </div>`;
    }
  }

  let html = '';
  const onlineCount = (onlineHtml.match(/gmp-member"/g) || []).length;
  const offlineCount = (offlineHtml.match(/gmp-member"/g) || []).length;
  if (onlineHtml) html += `<div class="gmp-section"><div class="gmp-section-label">Online - ${onlineCount}</div>${onlineHtml}</div>`;
  if (offlineHtml) html += `<div class="gmp-section"><div class="gmp-section-label">Offline - ${offlineCount}</div>${offlineHtml}</div>`;
  list.innerHTML = html || '<div style="padding:12px;color:#5a4e75;font-size:12px">No members</div>';
}

// Toggle group members panel
document.getElementById('group-members-toggle')?.addEventListener('click', () => {
  const panel = document.getElementById('group-members-panel');
  const chatArea = document.querySelector('.msg-chat-area');
  const btn = document.getElementById('group-members-toggle');
  if (!panel) return;
  const isHidden = panel.classList.toggle('hidden');
  if (isHidden) {
    chatArea?.classList.remove('has-members-panel');
  } else {
    chatArea?.classList.add('has-members-panel');
  }
  btn?.classList.toggle('active', !isHidden);
});

// =================== ADD PEOPLE TO GROUP ===================
const addToGroupModal = document.getElementById('add-to-group-modal');
document.getElementById('msg-add-to-group-btn')?.addEventListener('click', () => {
  addToGroupModal?.classList.remove('hidden');
  const input = document.getElementById('group-invite-input');
  if (input) { input.value = ''; input.focus(); }
  document.getElementById('group-invite-results').innerHTML = '';
});

document.getElementById('close-add-to-group')?.addEventListener('click', () => {
  addToGroupModal?.classList.add('hidden');
});

addToGroupModal?.addEventListener('click', (e) => {
  if (e.target === addToGroupModal) addToGroupModal.classList.add('hidden');
});

// Group invite search
let groupInviteTimeout;
document.getElementById('group-invite-input')?.addEventListener('input', (e) => {
  clearTimeout(groupInviteTimeout);
  groupInviteTimeout = setTimeout(async () => {
    const query = e.target.value.trim();
    const resultsEl = document.getElementById('group-invite-results');
    if (query.length < 2) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<div class="loading-spinner"><i class="ri-loader-4-line"></i></div>';
    const results = await searchUsers(query);
    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="empty-state small"><p>No users found</p></div>';
      return;
    }
    resultsEl.innerHTML = results.map(u => `
      <div class="search-result-item">
        <span>${escapeHtml(u.username)}</span>
        <button class="send-request-btn" data-uid="${u.uid}">Invite</button>
      </div>
    `).join('');
    resultsEl.querySelectorAll('.send-request-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Invited!';
        // Send group invite via Firestore
        if (currentGroupId && btn.dataset.uid) {
          try {
            await inviteToGroup(currentGroupId, btn.dataset.uid);
          } catch (e) { console.error('Failed to invite:', e); }
        }
      });
    });
  }, 400);
});

// =================== CHAT ===================
window.addEventListener('open-chat', (e) => {
  openChat(e.detail);
});

document.getElementById('send-message-btn')?.addEventListener('click', () => {
  const input = document.getElementById('chat-input');
  if (input && input.value.trim()) {
    if (currentGroupId) {
      sendGroupMessage(currentGroupId, input.value);
    } else {
      sendMessage(input.value);
    }
    input.value = '';
  }
});

document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    if (currentGroupId) {
      sendGroupMessage(currentGroupId, e.target.value);
    } else {
      sendMessage(e.target.value);
    }
    e.target.value = '';
  }
});

// Typing indicator
document.getElementById('chat-input')?.addEventListener('input', () => {
  sendTypingIndicator();
});

// =================== MESSAGE ACTIONS (delegated) ===================
document.getElementById('chat-messages')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.msg-action-tiny');
  if (!btn) return;
  const msgId = btn.dataset.msgId;
  if (!msgId) return;

  if (btn.classList.contains('reply-msg-btn')) {
    const msgEl = btn.closest('.msg-message');
    const text = msgEl?.querySelector('.msg-message-text')?.textContent || '';
    replyToMessage(msgId, text);
  } else if (btn.classList.contains('edit-msg-btn')) {
    editMessage(msgId);
  } else if (btn.classList.contains('delete-msg-btn')) {
    deleteMessage(msgId);
  } else if (btn.classList.contains('react-msg-btn')) {
    reactToMessage(msgId);
  }
});

// =================== EMOJI PICKER ===================
document.getElementById('emoji-picker-btn')?.addEventListener('click', () => toggleEmojiPicker());

document.addEventListener('click', (e) => {
  const picker = document.getElementById('emoji-picker');
  const btn = document.getElementById('emoji-picker-btn');
  if (picker && !picker.contains(e.target) && !btn.contains(e.target)) {
    picker.classList.add('hidden');
  }
});

// =================== VOICE / VIDEO CALLS ===================
document.getElementById('voice-call-btn')?.addEventListener('click', () => startCall());
document.getElementById('msg-video-call-btn')?.addEventListener('click', () => startVideoCall());

// Group call button
document.getElementById('group-call-btn')?.addEventListener('click', async () => {
  const group = window.__currentGroupForCall;
  if (group) {
    try {
      await startGroupCall(group.id, group.name);
    } catch (e) {
      console.error('[GROUP CALL] Failed:', e);
    }
  } else {
    console.error('[GROUP CALL] No group selected');
  }
});
document.getElementById('call-accept-btn')?.addEventListener('click', () => acceptCall());
document.getElementById('call-decline-btn')?.addEventListener('click', () => declineCall());
document.getElementById('call-hangup-btn')?.addEventListener('click', () => endCall());
document.getElementById('call-mute-btn')?.addEventListener('click', (e) => {
  const isMuted = toggleMute();
  const btn = e.currentTarget;
  btn.classList.toggle('active', isMuted);
  btn.querySelector('i').className = isMuted ? 'ri-mic-off-line' : 'ri-mic-line';
});

// File attach
document.getElementById('msg-attach-btn')?.addEventListener('click', () => sendFileMessage());

// =================== MODS ===================
let modSearchTimeout;
document.getElementById('mod-search-input')?.addEventListener('input', (e) => {
  clearTimeout(modSearchTimeout);
  // Toggle recommended section
  const recSection = document.getElementById('recommended-mods-section');
  const modResults = document.getElementById('mod-results');
  if (e.target.value.trim().length > 0) {
    if (recSection) recSection.style.display = 'none';
    if (modResults) modResults.style.display = '';
  } else {
    if (recSection) recSection.style.display = '';
    if (modResults) modResults.style.display = '';
  }
  modSearchTimeout = setTimeout(async () => {
    const query = e.target.value.trim();
    if (query.length < 2) return;
    document.getElementById('mod-results').innerHTML = '<div class="loading-spinner"><i class="ri-loader-4-line"></i> Searching...</div>';
    const results = await searchMods(query);
    renderModResults(results);
  }, 500);
});

document.getElementById('mod-search-input')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    clearTimeout(modSearchTimeout);
    const query = e.target.value.trim();
    if (query.length < 2) return;
    document.getElementById('mod-results').innerHTML = '<div class="loading-spinner"><i class="ri-loader-4-line"></i> Searching...</div>';
    const results = await searchMods(query);
    renderModResults(results);
  }
});

document.querySelectorAll('.source-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const query = document.getElementById('mod-search-input').value.trim();
    if (query.length >= 2) searchMods(query, btn.dataset.source).then(renderModResults);
  });
});

document.getElementById('mod-detail-back')?.addEventListener('click', () => closeModDetail());

// Loader filter buttons (search view)
document.querySelectorAll('.mod-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mod-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setLoaderFilter(btn.dataset.loader);
    const query = document.getElementById('mod-search-input').value.trim();
    if (query.length >= 2) {
      document.getElementById('mod-results').innerHTML = '<div class="loading-spinner"><i class="ri-loader-4-line"></i> Searching...</div>';
      searchMods(query).then(results => renderModResults(results));
    }
  });
});

// Version filter dropdown (search view)
document.getElementById('mod-version-filter')?.addEventListener('change', (e) => {
  setGameVersionFilter(e.target.value);
  const query = document.getElementById('mod-search-input').value.trim();
  if (query.length >= 2) {
    document.getElementById('mod-results').innerHTML = '<div class="loading-spinner"><i class="ri-loader-4-line"></i> Searching...</div>';
    searchMods(query).then(results => renderModResults(results));
  }
});

// Detail view loader filter buttons
document.querySelectorAll('.detail-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.detail-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setDetailLoaderFilter(btn.dataset.loader);
    filterDetailVersions();
  });
});

// Detail view version filter dropdown
document.getElementById('detail-version-filter')?.addEventListener('change', (e) => {
  setDetailGameVersionFilter(e.target.value);
  filterDetailVersions();
});

// Populate version dropdowns on page load
populateVersionDropdown('mod-version-filter');
populateVersionDropdown('detail-version-filter');

// =================== RECOMMENDED MODS ===================
let currentRecCategory = 'popular';
document.querySelectorAll('.rec-cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rec-cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRecCategory = btn.dataset.category;
    loadRecommendedMods(btn.dataset.category);
  });
});

// Install All recommended mods in current category
document.getElementById('install-all-pack')?.addEventListener('click', async () => {
  const btn = document.getElementById('install-all-pack');
  const RECOMMENDED_SLUGS = {
    popular: ['sodium', 'iris', 'lithium', 'fabric-api', 'modmenu', 'journeymap', 'jei', 'xaeros-minimap', 'appleskin', 'waystones'],
    performance: ['sodium', 'lithium', 'starlight', 'ferritecore', 'entityculling', 'memoryleakfix', 'immediatelyfast', 'modernfix'],
    qol: ['modmenu', 'appleskin', 'roughly-enough-items', 'mouse-tweaks', 'controlling', 'inventory-profiles-next', 'jade', 'light-overlay'],
    worldgen: ['terralith', 'biomes-o-plenty', 'tectonic', 'nullscape', 'amplified-nether', 'geophilic', 'regions-unexplored'],
    libraries: ['fabric-api', 'cloth-config', 'architectury-api', 'geckolib', 'moonlight', 'iceberg', 'puzzles-lib']
  };
  const slugs = RECOMMENDED_SLUGS[currentRecCategory] || RECOMMENDED_SLUGS.popular;
  btn.disabled = true;
  btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Installing 0/${slugs.length}...`;

  let installed = 0;
  let failed = 0;
  for (const slug of slugs) {
    try {
      // Quick install each mod (from mods.js via the grid buttons)
      const allBtns = document.querySelectorAll(`.quick-install-btn[data-slug="${slug}"]`);
      if (allBtns.length > 0) {
        allBtns[0].click();
      } else {
        // Fallback: use Modrinth API directly
        const res = await fetch(`https://api.modrinth.com/v2/project/${slug}/version`);
        const versions = await res.json();
        if (versions?.length > 0 && versions[0].files?.[0]) {
          const file = versions[0].files[0];
          await window.electronAPI.downloadFile(file.url, file.filename);
        }
      }
      installed++;
    } catch (e) { failed++; }
    btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Installing ${installed}/${slugs.length}...`;
  }

  btn.innerHTML = `<i class="ri-check-line"></i> Installed ${installed}/${slugs.length}`;
  btn.disabled = false;
  refreshDownloadedMods();
  setTimeout(() => { btn.innerHTML = '<i class="ri-download-fill"></i> Install All'; }, 4000);
});

// =================== SETTINGS ===================
async function loadSavedSettings() {
  try {
    const s = await window.electronAPI.getSettings();
    const javaInput = document.getElementById('setting-java-path');
    if (javaInput && s.javaPath) javaInput.value = s.javaPath;
    const ramSlider = document.getElementById('setting-ram');
    const ramDisplay = document.getElementById('ram-display');
    if (ramSlider && s.ramMax) { ramSlider.value = s.ramMax; if (ramDisplay) ramDisplay.textContent = s.ramMax; }
    const jvmInput = document.getElementById('setting-jvm-args');
    if (jvmInput && s.jvmArgs) jvmInput.value = s.jvmArgs;
    const consoleToggle = document.getElementById('setting-show-console');
    if (consoleToggle) consoleToggle.checked = !!s.showConsole;
    const behaviorSelect = document.getElementById('setting-launch-behavior');
    if (behaviorSelect && s.launchBehavior) behaviorSelect.value = s.launchBehavior;
    const autoUpdate = document.getElementById('setting-auto-update');
    if (autoUpdate) autoUpdate.checked = !!s.autoUpdate;
    const showNews = document.getElementById('setting-show-news');
    if (showNews) showNews.checked = s.showNews !== false;
    // AI API Key
    const aiKeyInput = document.getElementById('setting-ai-api-key');
    if (aiKeyInput && s.aiApiKey) aiKeyInput.value = s.aiApiKey;
    // FPS Boost
    const fpsBoost = document.getElementById('setting-fps-boost');
    if (fpsBoost) {
      fpsBoost.checked = !!s.fpsBoost;
      updateBoostUI(!!s.fpsBoost);
    }
    const boostProfile = document.getElementById('setting-boost-profile');
    if (boostProfile && s.boostProfile) boostProfile.value = s.boostProfile;
    updateBoostInfoText(s.boostProfile || 'balanced');
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function updateBoostUI(enabled) {
  const details = document.getElementById('fps-boost-details');
  const infoBox = document.getElementById('boost-info-box');
  if (details) details.style.display = enabled ? 'flex' : 'none';
  if (infoBox) infoBox.style.display = enabled ? 'flex' : 'none';
}

function updateBoostInfoText(profile) {
  const textEl = document.getElementById('boost-info-text');
  if (!textEl) return;
  const descriptions = {
    'balanced': 'G1 Garbage Collector, Optimized heap regions (8M), Parallel ref processing, Pre-touch memory, Reduced GC pause target (200ms)',
    'max-fps': 'G1GC with aggressive tuning, Large heap regions (16M), 30% new gen, Pre-touch + Always pre-touch, String dedup, GC pause target (100ms), Compact strings',
    'low-end': 'G1GC with minimal overhead, Small heap regions (4M), Conservative new gen (20%), Tiered compilation disabled for faster startup, Reduced GC threads'
  };
  textEl.textContent = descriptions[profile] || descriptions['balanced'];
}

document.getElementById('setting-java-browse')?.addEventListener('click', async () => {
  const path = await window.electronAPI.browseJava();
  if (path) { document.getElementById('setting-java-path').value = path; await window.electronAPI.setSetting('javaPath', path); }
});
document.getElementById('setting-java-clear')?.addEventListener('click', async () => {
  document.getElementById('setting-java-path').value = '';
  await window.electronAPI.setSetting('javaPath', null);
});
document.getElementById('setting-ram')?.addEventListener('input', (e) => {
  document.getElementById('ram-display').textContent = e.target.value;
  window.electronAPI.setSetting('ramMax', parseInt(e.target.value));
});
document.getElementById('setting-jvm-args')?.addEventListener('change', (e) => { window.electronAPI.setSetting('jvmArgs', e.target.value); });
document.getElementById('setting-show-console')?.addEventListener('change', (e) => { window.electronAPI.setSetting('showConsole', e.target.checked); });
document.getElementById('setting-launch-behavior')?.addEventListener('change', (e) => { window.electronAPI.setSetting('launchBehavior', e.target.value); });
document.getElementById('setting-auto-update')?.addEventListener('change', (e) => { window.electronAPI.setSetting('autoUpdate', e.target.checked); });
document.getElementById('setting-show-news')?.addEventListener('change', (e) => {
  window.electronAPI.setSetting('showNews', e.target.checked);
  const newsSection = document.getElementById('mc-news-section');
  if (newsSection) newsSection.style.display = e.target.checked ? '' : 'none';
});
// FPS Boost
document.getElementById('setting-fps-boost')?.addEventListener('change', (e) => {
  window.electronAPI.setSetting('fpsBoost', e.target.checked);
  updateBoostUI(e.target.checked);
});
document.getElementById('setting-boost-profile')?.addEventListener('change', (e) => {
  window.electronAPI.setSetting('boostProfile', e.target.value);
  updateBoostInfoText(e.target.value);
});
// AI API Key
document.getElementById('setting-ai-api-key')?.addEventListener('change', (e) => {
  window.electronAPI.setSetting('aiApiKey', e.target.value.trim());
});
document.getElementById('ai-key-toggle')?.addEventListener('click', () => {
  const input = document.getElementById('setting-ai-api-key');
  const btn = document.getElementById('ai-key-toggle');
  if (input && btn) {
    if (input.type === 'password') { input.type = 'text'; btn.textContent = 'Hide'; }
    else { input.type = 'password'; btn.textContent = 'Show'; }
  }
});

// =================== MINECRAFT NEWS ===================
async function loadMinecraftNews() {
  const grid = document.getElementById('mc-news-grid');
  const section = document.getElementById('mc-news-section');
  if (!grid || !section) return;

  // Check showNews setting
  try {
    const showNews = await window.electronAPI.getSetting('showNews', true);
    if (!showNews) { section.style.display = 'none'; return; }
  } catch (_) {}

  try {
    const res = await fetch('https://launchercontent.mojang.com/v2/javaPatchNotes.json');
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    const entries = (data.entries || []).slice(0, 8);

    if (!entries.length) {
      grid.innerHTML = '<div class="mc-news-error">No news available</div>';
      return;
    }

    grid.innerHTML = entries.map(entry => {
      const imgUrl = entry.image ? `https://launchercontent.mojang.com${entry.image.url}` : '';
      const date = entry.date ? new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const tag = entry.version || 'Update';
      const title = entry.title || 'Minecraft Update';
      return `
        <div class="mc-news-card" data-id="${entry.contentPath || ''}">
          ${imgUrl ? `<img class="mc-news-card-img" src="${imgUrl}" alt="" loading="lazy" />` : ''}
          <div class="mc-news-card-body">
            <span class="mc-news-card-tag">${tag}</span>
            <h4 class="mc-news-card-title">${title}</h4>
            <span class="mc-news-card-date">${date}</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<div class="mc-news-error">Could not load news</div>';
  }
}

// =================== CALL BANNER ===================
document.getElementById('call-banner-end-btn')?.addEventListener('click', () => { endCall(); });

// =================== VOICE CONNECTED PANEL ===================
const voicePanel = document.getElementById('voice-panel');
const voicePanelBar = document.getElementById('voice-panel-bar');
const voicePanelBody = document.getElementById('voice-panel-body');

// Click bar to expand/collapse
voicePanelBar?.addEventListener('click', () => {
  voicePanelBody?.classList.toggle('hidden');
});

// Controls
document.getElementById('vp-hangup-btn')?.addEventListener('click', () => {
  if (isGroupCall()) endGroupCall(); else endCall();
});

document.getElementById('vp-mute-btn')?.addEventListener('click', (e) => {
  const isMuted = toggleMute();
  const btn = e.currentTarget;
  btn.classList.toggle('muted', isMuted);
  btn.querySelector('i').className = isMuted ? 'ri-mic-off-fill' : 'ri-mic-line';
});

document.getElementById('vp-screen-btn')?.addEventListener('click', async () => {
  const { startScreenShare } = await import('./chat.js');
  startScreenShare();
});

document.getElementById('vp-fullscreen-btn')?.addEventListener('click', () => {
  if (isGroupCall()) restoreGroupCall();
});

function showVoicePanel(name) {
  if (!voicePanel) return;
  voicePanel.classList.remove('hidden');
  const ch = document.getElementById('voice-panel-channel');
  if (ch) ch.textContent = name || 'Voice Call';
  // Show/hide fullscreen button (only for group calls)
  const fsBtn = document.getElementById('vp-fullscreen-btn');
  if (fsBtn) fsBtn.style.display = isGroupCall() ? '' : 'none';
}

function hideVoicePanel() {
  if (voicePanel) voicePanel.classList.add('hidden');
  if (voicePanelBody) voicePanelBody.classList.add('hidden');
}

function updateVoicePanelMembers(members) {
  const container = document.getElementById('voice-panel-members');
  if (!container) return;
  const myUid = window.__currentUid;
  let html = '';
  for (const [uid, data] of Object.entries(members)) {
    if (data.state !== 'in-call') continue;
    const isMe = uid === myUid;
    html += `
      <div class="vp-member">
        <div class="vp-member-avatar"><i class="ri-user-fill"></i></div>
        <span class="vp-member-name ${isMe ? 'is-me' : ''}">${isMe ? 'You' : (data.username || 'Unknown')}</span>
      </div>`;
  }
  container.innerHTML = html || '<div style="padding:8px 12px;color:#7c6fab;font-size:12px">No one else yet</div>';
}

// Show/hide panel when call starts/ends
let inCallNow = false;

window.addEventListener('call-started', (e) => {
  inCallNow = true;
  showVoicePanel(e.detail?.name);
  updateOverlayToggle();
  if (isMcRunning()) {
    try { window.electronAPI.showOverlay(); } catch (e2) {}
  }
});

window.addEventListener('call-ended', () => {
  inCallNow = false;
  hideVoicePanel();
  try { window.electronAPI.hideOverlay(); } catch (e) {}
  updateOverlayToggle();
});

// Group call minimized — show voice panel, keep call alive
window.addEventListener('gc-minimized', (e) => {
  showVoicePanel(e.detail?.name || 'Group Call');
  if (e.detail?.members) updateVoicePanelMembers(e.detail.members);
});

// Group call restored — hide voice panel, full-screen is back
window.addEventListener('gc-restored', () => {
  hideVoicePanel();
});

// Listen for participant updates from chat.js to keep panel in sync
window.addEventListener('gc-members-updated', (e) => {
  if (e.detail?.members) updateVoicePanelMembers(e.detail.members);
  // Update timer with count
  const count = Object.values(e.detail?.members || {}).filter(m => m.state === 'in-call').length;
  const ch = document.getElementById('voice-panel-channel');
  if (ch && e.detail?.name) ch.textContent = `${e.detail.name} (${count})`;
});

// When MC starts/stops, manage overlay based on call state
window.addEventListener('mc-running-changed', (e) => {
  const running = e.detail?.running;
  updateOverlayToggle();
  if (running && inCallNow) {
    // MC just launched while in a call → show overlay
    try { window.electronAPI.showOverlay(); } catch (e2) {}
  }
  if (!running) {
    // MC closed → hide overlay
    try { window.electronAPI.hideOverlay(); } catch (e2) {}
  }
});

// Overlay toggle button logic
const overlayToggleBtn = document.getElementById('overlay-toggle-btn');
function updateOverlayToggle() {
  if (overlayToggleBtn) {
    // Show the toggle button only when in call AND MC is running
    if (inCallNow && isMcRunning()) {
      overlayToggleBtn.classList.remove('hidden');
    } else {
      overlayToggleBtn.classList.add('hidden');
    }
  }
}
if (overlayToggleBtn) {
  overlayToggleBtn.addEventListener('click', async () => {
    try {
      const result = await window.electronAPI.toggleOverlay();
      if (result && result.success) {
        overlayToggleBtn.classList.toggle('overlay-active', result.visible);
      }
    } catch (e) {}
  });
}

// =================== MC LOGIN SYSTEM ===================
let mcLoginMode = 'offline';
let msAuthData = null;

function setupMsLoginBtn() {
  document.getElementById('mc-microsoft-login-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('mc-login-status');
    const inputArea = document.getElementById('mc-login-input-area');
    if (statusEl) { statusEl.textContent = 'Opening Microsoft login...'; statusEl.className = 'mc-login-status'; }

    try {
      const result = await window.electronAPI.msAuthLogin();
      if (result.success) {
        msAuthData = result;
        if (statusEl) { statusEl.textContent = `Logged in as ${result.username}`; statusEl.className = 'mc-login-status success'; }
        if (inputArea) inputArea.innerHTML = `<div class="ms-auth-info"><i class="ri-microsoft-fill"></i> <strong>${result.username}</strong> <button class="mc-login-btn" id="mc-ms-logout-btn"><i class="ri-logout-box-line"></i> Logout</button></div>`;
        document.getElementById('mc-ms-logout-btn')?.addEventListener('click', async () => {
          await window.electronAPI.msAuthLogout();
          msAuthData = null;
          if (statusEl) { statusEl.textContent = 'Logged out'; statusEl.className = 'mc-login-status'; }
          if (inputArea) inputArea.innerHTML = '<button class="mc-login-btn" id="mc-microsoft-login-btn"><i class="ri-login-box-line"></i> Sign in with Microsoft</button>';
          setupMsLoginBtn();
        });
      } else {
        if (statusEl) { statusEl.textContent = result.error || 'Login failed'; statusEl.className = 'mc-login-status error'; }
      }
    } catch (e) {
      if (statusEl) { statusEl.textContent = 'Login error: ' + e.message; statusEl.className = 'mc-login-status error'; }
    }
  });
}

document.querySelectorAll('.mc-login-options > .mc-login-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mc-login-options > .mc-login-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mcLoginMode = btn.dataset.login;
    window.electronAPI.setSetting('mcLoginMode', mcLoginMode);
    const inputArea = document.getElementById('mc-login-input-area');
    const statusEl = document.getElementById('mc-login-status');

    if (mcLoginMode === 'offline') {
      const savedUsername = document.getElementById('mc-offline-username')?.value || '';
      inputArea.innerHTML = '<input type="text" id="mc-offline-username" placeholder="Enter username..." /><button class="mc-save-username-btn" id="mc-save-username-btn" title="Save username"><i class="ri-save-line"></i> Save</button>';
      if (savedUsername) document.getElementById('mc-offline-username').value = savedUsername;
      // Re-attach save handler
      document.getElementById('mc-save-username-btn')?.addEventListener('click', async () => {
        const usernameInput = document.getElementById('mc-offline-username');
        if (usernameInput && usernameInput.value.trim()) {
          await window.electronAPI.setSetting('mcUsername', usernameInput.value.trim());
          const btn = document.getElementById('mc-save-username-btn');
          if (btn) { btn.innerHTML = '<i class="ri-check-line"></i> Saved!'; setTimeout(() => { btn.innerHTML = '<i class="ri-save-line"></i> Save'; }, 2000); }
        }
      });
      // Restore saved username
      window.electronAPI.getSetting('mcUsername', '').then(name => {
        const input = document.getElementById('mc-offline-username');
        if (input && name && !input.value) input.value = name;
      });
      if (statusEl) { statusEl.textContent = 'Playing in offline/cracked mode'; statusEl.className = 'mc-login-status'; }
    } else if (mcLoginMode === 'microsoft') {
      inputArea.innerHTML = '<button class="mc-login-btn" id="mc-microsoft-login-btn"><i class="ri-login-box-line"></i> Sign in with Microsoft</button>';
      if (statusEl) { statusEl.textContent = 'Click to sign in with your Microsoft account'; statusEl.className = 'mc-login-status'; }
      setupMsLoginBtn();
      // Check existing auth
      window.electronAPI.msAuthCheck().then(state => {
        if (state.loggedIn) {
          msAuthData = state;
          if (statusEl) { statusEl.textContent = `Logged in as ${state.username}`; statusEl.className = 'mc-login-status success'; }
          if (inputArea) inputArea.innerHTML = `<div class="ms-auth-info"><i class="ri-microsoft-fill"></i> <strong>${state.username}</strong> <button class="mc-login-btn" id="mc-ms-logout-btn"><i class="ri-logout-box-line"></i> Logout</button></div>`;
          document.getElementById('mc-ms-logout-btn')?.addEventListener('click', async () => {
            await window.electronAPI.msAuthLogout();
            msAuthData = null;
            if (statusEl) { statusEl.textContent = 'Logged out'; statusEl.className = 'mc-login-status'; }
            if (inputArea) inputArea.innerHTML = '<button class="mc-login-btn" id="mc-microsoft-login-btn"><i class="ri-login-box-line"></i> Sign in with Microsoft</button>';
            setupMsLoginBtn();
          });
        }
      });
    } else if (mcLoginMode === 'elyby') {
      inputArea.innerHTML = '<input type="text" id="mc-elyby-username" placeholder="Ely.by username..." /><input type="password" id="mc-elyby-password" placeholder="Password..." style="margin-left:8px" /><button class="mc-login-btn" id="mc-elyby-login-btn" style="margin-left:8px"><i class="ri-login-box-line"></i> Login</button>';
      if (statusEl) { statusEl.textContent = 'Ely.by allows custom skins for cracked accounts'; statusEl.className = 'mc-login-status'; }
    }
  });
});

// Get MC username based on login mode
window.getMcUsername = () => {
  if (mcLoginMode === 'microsoft' && msAuthData && msAuthData.username) {
    return msAuthData.username;
  }
  if (mcLoginMode === 'offline') {
    return document.getElementById('mc-offline-username')?.value?.trim() || currentProfile?.username || 'VDeXPlayer';
  }
  return currentProfile?.username || 'VDeXPlayer';
};

// =================== MOD SYNC (folder <-> launcher) ===================
// Refresh downloaded mods when navigating to mods page
// (no polling — refreshes on page switch only)
document.querySelector('.nav-item[data-page="mods"]')?.addEventListener('click', () => {
  setTimeout(() => refreshDownloadedMods(), 300);
});

// Refresh client mods when navigating to client page
document.querySelector('.nav-item[data-page="client"]')?.addEventListener('click', () => {
  setTimeout(() => initClient(), 100);
});

// =================== BUG REPORTS (Firestore — shared across all players) ===================
let bugsData = { username: null, bugs: [] };
let bugsUnsubscribe = null;

async function loadBugsData() {
  // Load local username from electron (still per-user)
  try {
    const localData = await window.electronAPI.getBugs();
    bugsData.username = localData.username;
  } catch (e) {}

  // Load bugs from Firestore (shared across all players)
  try {
    const bugsRef = collection(db, 'bugReports');
    const q = query(bugsRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    bugsData.bugs = [];
    snapshot.forEach(d => {
      bugsData.bugs.push({ id: d.id, ...d.data() });
    });
  } catch (e) {
    console.error('Failed to load bugs from Firestore:', e);
    // Fallback to local
    try {
      const localData = await window.electronAPI.getBugs();
      bugsData.bugs = localData.bugs || [];
    } catch (e2) {}
  }
  renderBugsUI();
}

function listenForBugs() {
  if (bugsUnsubscribe) bugsUnsubscribe();
  try {
    const bugsRef = collection(db, 'bugReports');
    const q = query(bugsRef, orderBy('createdAt', 'desc'));
    bugsUnsubscribe = onSnapshot(q, (snapshot) => {
      bugsData.bugs = [];
      snapshot.forEach(d => {
        bugsData.bugs.push({ id: d.id, ...d.data() });
      });
      renderBugsList();
    });
  } catch (e) {
    console.error('Failed to listen for bugs:', e);
  }
}

function renderBugsUI() {
  const usernameSection = document.getElementById('bugs-username-section');
  const reporterInfo = document.getElementById('bugs-reporter-info');
  const reporterName = document.getElementById('bugs-reporter-name');

  if (bugsData.username) {
    if (usernameSection) usernameSection.style.display = 'none';
    if (reporterInfo) { reporterInfo.classList.remove('hidden'); }
    if (reporterName) reporterName.textContent = bugsData.username;
  } else {
    if (usernameSection) usernameSection.style.display = '';
    if (reporterInfo) reporterInfo.classList.add('hidden');
  }

  renderBugsList();
}

function renderBugsList() {
  const list = document.getElementById('bugs-list');
  const count = document.getElementById('bugs-count');
  if (!list) return;

  if (count) count.textContent = bugsData.bugs.length;

  if (bugsData.bugs.length === 0) {
    list.innerHTML = `
      <div class="bugs-empty">
        <i class="ri-bug-line"></i>
        <p>No bugs reported yet</p>
        <span>Click "Report a Bug" to submit your first report</span>
      </div>`;
    return;
  }

  list.innerHTML = bugsData.bugs.map(bug => `
    <div class="bug-item" data-bug-id="${bug.id}">
      <div class="bug-item-header">
        <div class="bug-item-status ${bug.status || 'open'}">${bug.status || 'open'}</div>
        <h4 class="bug-item-title">${escapeHtml(bug.title)}</h4>
        <button class="bug-delete-btn" data-bug-id="${bug.id}" title="Delete"><i class="ri-delete-bin-line"></i></button>
      </div>
      <p class="bug-item-issue">${escapeHtml(bug.issue)}</p>
      <div class="bug-item-meta">
        <span><i class="ri-user-fill"></i> ${escapeHtml(bug.reporter)}</span>
        <span><i class="ri-time-line"></i> ${new Date(bug.createdAt).toLocaleDateString()} ${new Date(bug.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  `).join('');

  // Delete buttons
  list.querySelectorAll('.bug-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this bug report?')) return;
      try {
        await deleteDoc(doc(db, 'bugReports', btn.dataset.bugId));
      } catch (err) {
        // Fallback to local delete
        await window.electronAPI.deleteBug(btn.dataset.bugId);
        await loadBugsData();
      }
    });
  });
}

// Save bugs username (one-time)
document.getElementById('bugs-username-save-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('bugs-username-input');
  const error = document.getElementById('bugs-username-error');
  const name = input?.value.trim();
  if (error) error.textContent = '';

  if (!name || name.length < 2) {
    if (error) error.textContent = 'Name must be at least 2 characters.';
    return;
  }

  const result = await window.electronAPI.setBugsUsername(name);
  if (result.success) {
    bugsData.username = name;
    renderBugsUI();
  } else {
    if (error) error.textContent = result.error || 'Failed to save name.';
  }
});

// Toggle bug form
document.getElementById('bugs-add-btn')?.addEventListener('click', () => {
  const form = document.getElementById('bugs-form');
  if (form) {
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) {
      document.getElementById('bug-title-input')?.focus();
    }
  }
});

document.getElementById('bugs-cancel-btn')?.addEventListener('click', () => {
  document.getElementById('bugs-form')?.classList.add('hidden');
  document.getElementById('bug-title-input').value = '';
  document.getElementById('bug-issue-input').value = '';
  document.getElementById('bugs-form-error').textContent = '';
});

// Submit bug — now saves to Firestore so all players can see it
document.getElementById('bugs-submit-btn')?.addEventListener('click', async () => {
  const title = document.getElementById('bug-title-input')?.value.trim();
  const issue = document.getElementById('bug-issue-input')?.value.trim();
  const error = document.getElementById('bugs-form-error');
  if (error) error.textContent = '';

  if (!title) { if (error) error.textContent = 'Bug title is required.'; return; }
  if (!issue) { if (error) error.textContent = 'Issue description is required.'; return; }

  if (!bugsData.username) {
    if (error) error.textContent = 'Please set your reporter name first.';
    return;
  }

  try {
    await addDoc(collection(db, 'bugReports'), {
      title,
      issue,
      reporter: bugsData.username,
      reporterUid: auth.currentUser?.uid || 'anonymous',
      status: 'open',
      createdAt: new Date().toISOString()
    });

    document.getElementById('bug-title-input').value = '';
    document.getElementById('bug-issue-input').value = '';
    document.getElementById('bugs-form')?.classList.add('hidden');

    // Also save locally as backup
    try { await window.electronAPI.submitBug(title, issue); } catch (e) {}
  } catch (err) {
    // Fallback to local storage
    const result = await window.electronAPI.submitBug(title, issue);
    if (result.success) {
      document.getElementById('bug-title-input').value = '';
      document.getElementById('bug-issue-input').value = '';
      document.getElementById('bugs-form')?.classList.add('hidden');
      await loadBugsData();
    } else {
      if (error) error.textContent = result.error || 'Failed to submit bug.';
    }
  }
});

// Load bugs when navigating to bugs page — now listens in real-time
document.querySelector('.nav-item[data-page="bugs"]')?.addEventListener('click', () => {
  loadBugsData();
  listenForBugs();
});

// Initial load
loadBugsData();

// =================== CHAT SIGN-IN GATE ===================
// Toggle between sign-in and register forms
document.getElementById('chat-show-register')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelector('.chat-signin-form')?.classList.add('hidden');
  document.getElementById('chat-register-form')?.classList.remove('hidden');
  document.getElementById('chat-username-prompt')?.classList.add('hidden');
});

document.getElementById('chat-show-signin')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelector('.chat-signin-form')?.classList.remove('hidden');
  document.getElementById('chat-register-form')?.classList.add('hidden');
  document.getElementById('chat-username-prompt')?.classList.add('hidden');
});

// Email/password sign-in
document.getElementById('chat-signin-btn')?.addEventListener('click', async () => {
  const email = document.getElementById('chat-signin-email')?.value.trim();
  const password = document.getElementById('chat-signin-password')?.value;
  const errorEl = document.getElementById('chat-signin-error');
  if (errorEl) errorEl.textContent = '';

  if (!email || !password) {
    if (errorEl) errorEl.textContent = 'Please fill in all fields.';
    return;
  }

  try {
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js');
    await signInWithEmailAndPassword(auth, email, password);
    // Save credentials for auto-restore on next launch
    window.electronAPI?.setSetting('chatAuth', { method: 'email', email, password });
    chatSignInSuccess();
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message?.includes('invalid') ? 'Invalid email or password.' : (err.message || 'Sign-in failed.');
  }
});

// Google sign-in
document.getElementById('chat-google-signin-btn')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('chat-signin-error');
  if (errorEl) errorEl.textContent = '';

  try {
    const { GoogleAuthProvider, signInWithPopup } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js');
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);

    // Check if user has a profile, if not show username prompt
    const { doc: fbDoc, getDoc: fbGetDoc } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js');
    const { db } = await import('./firebase-config.js');
    const userDoc = await fbGetDoc(fbDoc(db, 'users', result.user.uid));
    if (!userDoc.exists()) {
      // New Google user — needs username
      document.querySelector('.chat-signin-form')?.classList.add('hidden');
      document.getElementById('chat-register-form')?.classList.add('hidden');
      document.getElementById('chat-username-prompt')?.classList.remove('hidden');
      window._chatPendingGoogleUser = result.user;
    } else {
      // Save that user signed in with Google for auto-restore
      window.electronAPI?.setSetting('chatAuth', { method: 'google' });
      chatSignInSuccess();
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = err.code === 'auth/popup-closed-by-user' ? 'Popup closed.' : (err.message || 'Sign-in failed.');
  }
});

// Register
document.getElementById('chat-register-btn')?.addEventListener('click', async () => {
  const username = document.getElementById('chat-register-username')?.value.trim();
  const email = document.getElementById('chat-register-email')?.value.trim();
  const password = document.getElementById('chat-register-password')?.value;
  const confirm = document.getElementById('chat-register-confirm')?.value;
  const errorEl = document.getElementById('chat-register-error');
  if (errorEl) errorEl.textContent = '';

  if (!username || !email || !password || !confirm) {
    if (errorEl) errorEl.textContent = 'Please fill in all fields.';
    return;
  }
  if (password !== confirm) {
    if (errorEl) errorEl.textContent = 'Passwords do not match.';
    return;
  }
  if (username.length < 3 || username.length > 20) {
    if (errorEl) errorEl.textContent = 'Username must be 3-20 characters.';
    return;
  }

  try {
    const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js');
    const { doc: fbDoc, setDoc: fbSetDoc } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js');
    const { db } = await import('./firebase-config.js');

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await fbSetDoc(fbDoc(db, 'users', cred.user.uid), {
      username: username,
      email: email,
      friends: [],
      createdAt: new Date().toISOString(),
      lastUsernameChange: new Date().toISOString()
    });
    // Save credentials for auto-restore on next launch
    window.electronAPI?.setSetting('chatAuth', { method: 'email', email, password });
    chatSignInSuccess();
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Registration failed.';
  }
});

// Username prompt for Google sign-in (new users)
document.getElementById('chat-username-submit')?.addEventListener('click', async () => {
  const username = document.getElementById('chat-prompt-username')?.value.trim();
  const errorEl = document.getElementById('chat-username-error');
  if (errorEl) errorEl.textContent = '';

  if (!username || username.length < 3 || username.length > 20) {
    if (errorEl) errorEl.textContent = 'Username must be 3-20 characters.';
    return;
  }

  const user = window._chatPendingGoogleUser || auth.currentUser;
  if (!user) return;

  try {
    const { doc: fbDoc, setDoc: fbSetDoc } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js');
    const { db } = await import('./firebase-config.js');
    await fbSetDoc(fbDoc(db, 'users', user.uid), {
      username: username,
      email: user.email,
      friends: [],
      createdAt: new Date().toISOString(),
      lastUsernameChange: new Date().toISOString()
    });
    // Save that user signed in with Google for auto-restore
    window.electronAPI?.setSetting('chatAuth', { method: 'google' });
    chatSignInSuccess();
  } catch (err) {
    if (errorEl) errorEl.textContent = 'Failed to save username. Try again.';
  }
});

// After successful sign-in, hide gate and show messenger
async function chatSignInSuccess() {
  const gate = document.getElementById('chat-signin-gate');
  const layout = document.querySelector('.messenger-layout');
  if (gate) gate.style.display = 'none';
  if (layout) layout.style.display = '';

  // Init chat features
  currentProfile = await getCurrentUserProfile();
  if (currentProfile) {
    document.getElementById('home-username').textContent = currentProfile.username;
    document.getElementById('home-display-username').textContent = currentProfile.username;
    document.getElementById('settings-username').textContent = currentProfile.username;
    document.getElementById('settings-email').textContent = currentProfile.email;
  }
  setCurrentUsername(currentProfile?.username || 'User');
  initPresence();
  initFriendsPage();
  initCallListener();
  listenForGroupCallInvites();
  initEmojiPicker();
  renderGroupsList();

  setTimeout(async () => {
    try {
      const friends = await getFriendsList();
      renderConversationList(friends);
    } catch (e) {}
  }, 1500);

  window.addEventListener('friends-updated', async () => {
    try {
      const friends = await getFriendsList();
      renderConversationList(friends);
    } catch (e) {}
  });
}

// =================== HELPERS ===================
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// =================== MODS SUB-TABS ===================
document.querySelectorAll('.mods-subtab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mods-subtab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.mods-subtab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const targetId = 'mtab-' + tab.dataset.mtab;
    const targetEl = document.getElementById(targetId);
    if (targetEl) targetEl.classList.add('active');

    // Load data on tab switch
    if (tab.dataset.mtab === 'shaders-browse') loadShaders();
    if (tab.dataset.mtab === 'resourcepacks-browse') loadResourcePacks();
  });
});

// =================== SERVER FINDER ===================
const popularServers = [
  { name: 'Hypixel', address: 'mc.hypixel.net', players: '75,000+', version: '1.8-1.21', category: 'minigames', desc: 'The largest Minecraft server. Skyblock, BedWars, SkyWars, and more!', icon: 'ri-sword-fill' },
  { name: 'Mineplex', address: 'us.mineplex.com', players: '3,000+', version: '1.8-1.21', category: 'minigames', desc: 'Classic minigames server with Cake Wars, Survival Games, and more.', icon: 'ri-gamepad-fill' },
  { name: '2b2t', address: '2b2t.org', players: '500+', version: '1.12.2', category: 'survival', desc: 'The oldest anarchy server in Minecraft. No rules, no resets.', icon: 'ri-skull-fill' },
  { name: 'CubeCraft', address: 'play.cubecraft.net', players: '5,000+', version: '1.8-1.21', category: 'minigames', desc: 'EggWars, SkyWars, Lucky Islands, and parkour challenges.', icon: 'ri-box-3-fill' },
  { name: 'The Hive', address: 'geo.hivebedrock.network', players: '10,000+', version: '1.21', category: 'minigames', desc: 'Treasure Wars, Murder Mystery, SkyWars, and more.', icon: 'ri-bug-fill' },
  { name: 'PvPLand', address: 'pvp.land', players: '1,000+', version: '1.8-1.21', category: 'pvp', desc: 'Competitive PvP with ranked duels, FFA, and practice modes.', icon: 'ri-sword-fill' },
  { name: 'ManaCube', address: 'play.manacube.com', players: '2,000+', version: '1.8-1.21', category: 'skyblock', desc: 'Skyblock, Parkour, Factions, Survival, and Islands.', icon: 'ri-cloud-fill' },
  { name: 'MineHeroes', address: 'play.mineheroes.net', players: '500+', version: '1.8-1.21', category: 'factions', desc: 'Factions, Prison, Skyblock, and KitPvP gamemodes.', icon: 'ri-shield-fill' },
  { name: 'EarthMC', address: 'play.earthmc.net', players: '1,500+', version: '1.20', category: 'survival', desc: 'Build nations on a 1:500 scale Earth map. Towny geopolitical.', icon: 'ri-earth-fill' },
  { name: 'Wynncraft', address: 'play.wynncraft.com', players: '1,200+', version: '1.20', category: 'rpg', desc: 'The largest MMORPG server with quests, dungeons, and classes.', icon: 'ri-magic-fill' },
  { name: 'MCPrison', address: 'mcprison.com', players: '800+', version: '1.8-1.21', category: 'prison', desc: 'The original prison server with mining, trading, and PvP.', icon: 'ri-lock-fill' },
  { name: 'PikaNetwork', address: 'play.pika-network.net', players: '4,000+', version: '1.8-1.21', category: 'minigames', desc: 'BedWars, SkyWars, Factions, Practice, and more gamemodes.', icon: 'ri-flashlight-fill' },
  { name: 'MCC Island', address: 'play.mccisland.net', players: '2,000+', version: '1.21', category: 'minigames', desc: 'Official MCC minigames - Hole in the Wall, TGTTOS, Sky Battle.', icon: 'ri-trophy-fill' },
  { name: 'Performium', address: 'play.performium.net', players: '600+', version: '1.8-1.21', category: 'creative', desc: 'Creative plots, survival, and building competitions.', icon: 'ri-pencil-ruler-fill' },
  { name: 'LemonCloud', address: 'play.lemoncloud.net', players: '500+', version: '1.8-1.21', category: 'skyblock', desc: 'Skyblock, Prison, and Factions with custom features.', icon: 'ri-cloud-fill' },
];

function renderServerFinder(filter = {}) {
  const grid = document.getElementById('sf-server-grid');
  if (!grid) return;
  let servers = [...popularServers];

  if (filter.search) {
    const q = filter.search.toLowerCase();
    servers = servers.filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q));
  }
  if (filter.category) servers = servers.filter(s => s.category === filter.category);
  if (filter.version) servers = servers.filter(s => s.version.includes(filter.version));
  if (filter.sort === 'name') servers.sort((a, b) => a.name.localeCompare(b.name));

  if (servers.length === 0) {
    grid.innerHTML = '<div class="sf-empty"><i class="ri-search-line" style="font-size:36px;display:block;margin-bottom:8px"></i><p>No servers found</p></div>';
    return;
  }

  grid.innerHTML = servers.map(s => `
    <div class="sf-server-card">
      <div class="sf-server-top">
        <div class="sf-server-icon"><i class="${s.icon}"></i></div>
        <div class="sf-server-info">
          <div class="sf-server-name">${escapeHtml(s.name)}</div>
          <div class="sf-server-address">${escapeHtml(s.address)}</div>
        </div>
      </div>
      <div class="sf-server-meta">
        <span class="sf-server-badge players"><i class="ri-group-fill"></i> ${s.players}</span>
        <span class="sf-server-badge version"><i class="ri-price-tag-3-fill"></i> ${s.version}</span>
        <span class="sf-server-badge category"><i class="ri-gamepad-fill"></i> ${s.category}</span>
      </div>
      <div class="sf-server-desc">${escapeHtml(s.desc)}</div>
      <div class="sf-server-actions">
        <button class="sf-join-btn" data-address="${escapeHtml(s.address)}"><i class="ri-play-fill"></i> Join Server</button>
        <button class="sf-copy-btn" data-address="${escapeHtml(s.address)}"><i class="ri-file-copy-line"></i></button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.sf-join-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const addr = btn.dataset.address;
      const version = getSelectedVersion() || document.getElementById('mc-version-select')?.value;
      const loader = getSelectedLoader() || 'vanilla';
      const username = window.getMcUsername?.() || 'VDeXPlayer';
      if (!version) {
        alert('Please go to the Home page and select a Minecraft version first.');
        return;
      }

      btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Launching...';
      btn.disabled = true;
      try {
        // mc-launch-server now auto-downloads MC if needed, launches, passes --server/--port, and hides launcher
        const result = await window.electronAPI.launchMinecraftServer(version, loader, username, addr);
        if (!result.success) {
          alert(result.error || 'Failed to join server');
          btn.innerHTML = '<i class="ri-play-fill"></i> Join Server';
        } else {
          btn.innerHTML = '<i class="ri-check-line"></i> Joining ' + addr + '...';
        }
      } catch (err) {
        alert('Error: ' + (err.message || String(err)));
        btn.innerHTML = '<i class="ri-play-fill"></i> Join Server';
      }
      btn.disabled = false;
      setTimeout(() => { btn.innerHTML = '<i class="ri-play-fill"></i> Join Server'; }, 8000);
    });
  });

  grid.querySelectorAll('.sf-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.address);
      btn.innerHTML = '<i class="ri-check-line"></i>';
      setTimeout(() => { btn.innerHTML = '<i class="ri-file-copy-line"></i>'; }, 1500);
    });
  });
}

// Server Finder filters
document.getElementById('sf-search-input')?.addEventListener('input', () => renderServerFinderFiltered());
document.getElementById('sf-category-filter')?.addEventListener('change', () => renderServerFinderFiltered());
document.getElementById('sf-version-filter')?.addEventListener('change', () => renderServerFinderFiltered());
document.getElementById('sf-sort-filter')?.addEventListener('change', () => renderServerFinderFiltered());

function renderServerFinderFiltered() {
  renderServerFinder({
    search: document.getElementById('sf-search-input')?.value || '',
    category: document.getElementById('sf-category-filter')?.value || '',
    version: document.getElementById('sf-version-filter')?.value || '',
    sort: document.getElementById('sf-sort-filter')?.value || 'players'
  });
}

// Load server finder on servers page visit
document.querySelector('.nav-item[data-page="servers"]')?.addEventListener('click', () => {
  setTimeout(() => renderServerFinder(), 100);
});

// Server subtab fix: make Server Finder the default
setTimeout(() => renderServerFinder(), 500);

// Servers subtab switching is handled by servers.js

// =================== SHADER MANAGER ===================
async function modrinthSearch(projectType, queryText, limit = 20) {
  // Use main process IPC for reliable network access
  const data = await window.electronAPI.modrinthSearch(projectType, queryText, limit);
  if (data.error) throw new Error(data.error);
  return data;
}

async function modrinthGetVersions(slug) {
  const data = await window.electronAPI.modrinthVersions(slug);
  if (data.error) throw new Error(data.error);
  return data;
}

async function loadShaders(searchQuery = '') {
  const resultsEl = document.getElementById('shader-results');
  const installedEl = document.getElementById('shader-installed-list');

  // Load installed shaders
  try {
    const installed = await window.electronAPI.listShaders();
    if (installed.length === 0) {
      installedEl.innerHTML = '<div class="empty-state small"><p>No shaders installed</p></div>';
    } else {
      installedEl.innerHTML = installed.map(s => `
        <div class="shader-installed-item">
          <i class="ri-contrast-fill" style="color:#a78bfa"></i>
          <span class="item-name">${escapeHtml(s.name)}</span>
          <span class="item-size">${formatBytes(s.size)}</span>
          <button class="item-delete" data-name="${escapeHtml(s.name)}"><i class="ri-delete-bin-line"></i></button>
        </div>
      `).join('');
      installedEl.querySelectorAll('.item-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete this shader?')) {
            await window.electronAPI.deleteShader(btn.dataset.name);
            loadShaders(searchQuery);
          }
        });
      });
    }
  } catch (e) { console.error('Failed to list shaders:', e); }

  // Search Modrinth for shaders
  const query = searchQuery || 'shader';
  resultsEl.innerHTML = '<div class="shader-loading"><i class="ri-loader-4-line ri-spin"></i> Searching shaders...</div>';
  try {
    const data = await modrinthSearch('shader', query);
    if (!data.hits || data.hits.length === 0) {
      resultsEl.innerHTML = '<div class="shader-empty"><p>No shaders found</p></div>';
      return;
    }
    resultsEl.innerHTML = data.hits.map(shader => `
      <div class="shader-card" data-id="${shader.project_id}">
        <div class="shader-card-preview">
          ${shader.icon_url ? `<img src="${shader.icon_url}" alt="${escapeHtml(shader.title)}" />` : '<i class="ri-contrast-fill"></i>'}
        </div>
        <div class="shader-card-body">
          <div class="shader-card-name">${escapeHtml(shader.title)}</div>
          <div class="shader-card-meta">
            <span><i class="ri-download-line"></i> ${(shader.downloads || 0).toLocaleString()}</span>
            <span><i class="ri-star-fill"></i> ${(shader.follows || 0).toLocaleString()}</span>
          </div>
          <div class="shader-card-actions">
            <button class="shader-install-btn" data-slug="${shader.slug}"><i class="ri-download-line"></i> Install</button>
          </div>
        </div>
      </div>
    `).join('');

    resultsEl.querySelectorAll('.shader-install-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Installing...';
        try {
          const versions = await modrinthGetVersions(btn.dataset.slug);
          if (versions.length > 0 && versions[0].files?.length > 0) {
            const file = versions[0].files[0];
            console.log('Installing shader:', file.url, file.filename);
            const result = await window.electronAPI.installShader(file.url, file.filename);
            if (result.success) {
              btn.innerHTML = '<i class="ri-check-line"></i> Installed!';
              setTimeout(() => loadShaders(searchQuery), 500);
            } else {
              console.error('Shader install failed:', result.error);
              btn.innerHTML = '<i class="ri-error-warning-line"></i> ' + (result.error || 'Failed');
            }
          } else { btn.innerHTML = '<i class="ri-error-warning-line"></i> No files'; }
        } catch (err) {
          console.error('Shader install error:', err);
          btn.innerHTML = '<i class="ri-error-warning-line"></i> Error';
        }
        btn.disabled = false;
        setTimeout(() => { btn.innerHTML = '<i class="ri-download-line"></i> Install'; }, 3000);
      });
    });
  } catch (e) {
    console.error('Shader search error:', e);
    resultsEl.innerHTML = '<div class="shader-empty"><p>Failed to load shaders: ' + escapeHtml(e.message) + '</p></div>';
  }
}

document.getElementById('shader-search-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadShaders(e.target.value.trim());
});

document.getElementById('shader-open-folder')?.addEventListener('click', () => window.electronAPI.openShadersFolder());

// Shader performance filters
document.querySelectorAll('.shader-perf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.shader-perf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const perf = btn.dataset.perf;
    const query = perf ? `${perf} shader` : 'shader';
    loadShaders(query);
  });
});

// =================== RESOURCE PACK LIBRARY ===================
async function loadResourcePacks(searchQuery = '') {
  const resultsEl = document.getElementById('rp-results');
  const installedEl = document.getElementById('rp-installed-list');

  // Load installed resource packs
  try {
    const installed = await window.electronAPI.listResourcePacks();
    if (installed.length === 0) {
      installedEl.innerHTML = '<div class="empty-state small"><p>No resource packs installed</p></div>';
    } else {
      installedEl.innerHTML = installed.map(rp => `
        <div class="rp-installed-item">
          <i class="ri-palette-fill" style="color:#a78bfa"></i>
          <span class="item-name">${escapeHtml(rp.name)}</span>
          <span class="item-size">${formatBytes(rp.size)}</span>
          <button class="item-delete" data-name="${escapeHtml(rp.name)}"><i class="ri-delete-bin-line"></i></button>
        </div>
      `).join('');
      installedEl.querySelectorAll('.item-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete this resource pack?')) {
            await window.electronAPI.deleteResourcePack(btn.dataset.name);
            loadResourcePacks(searchQuery);
          }
        });
      });
    }
  } catch (e) { console.error('Failed to list resource packs:', e); }

  // Search Modrinth for resource packs
  const query = searchQuery || 'resource pack';
  resultsEl.innerHTML = '<div class="rp-loading"><i class="ri-loader-4-line ri-spin"></i> Searching resource packs...</div>';
  try {
    const data = await modrinthSearch('resourcepack', query);
    if (!data.hits || data.hits.length === 0) {
      resultsEl.innerHTML = '<div class="rp-empty"><p>No resource packs found</p></div>';
      return;
    }
    resultsEl.innerHTML = data.hits.map(rp => `
      <div class="rp-card" data-id="${rp.project_id}">
        <div class="rp-card-preview">
          ${rp.icon_url ? `<img src="${rp.icon_url}" alt="${escapeHtml(rp.title)}" />` : '<i class="ri-palette-fill"></i>'}
        </div>
        <div class="rp-card-body">
          <div class="rp-card-name">${escapeHtml(rp.title)}</div>
          <div class="rp-card-meta">
            <span><i class="ri-download-line"></i> ${(rp.downloads || 0).toLocaleString()}</span>
            <span><i class="ri-star-fill"></i> ${(rp.follows || 0).toLocaleString()}</span>
          </div>
          <div class="rp-card-actions">
            <button class="rp-install-btn" data-slug="${rp.slug}"><i class="ri-download-line"></i> Install</button>
          </div>
        </div>
      </div>
    `).join('');

    resultsEl.querySelectorAll('.rp-install-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Installing...';
        try {
          const versions = await modrinthGetVersions(btn.dataset.slug);
          if (versions.length > 0 && versions[0].files?.length > 0) {
            const file = versions[0].files[0];
            console.log('Installing resource pack:', file.url, file.filename);
            const result = await window.electronAPI.installResourcePack(file.url, file.filename);
            if (result.success) {
              btn.innerHTML = '<i class="ri-check-line"></i> Installed!';
              setTimeout(() => loadResourcePacks(searchQuery), 500);
            } else {
              console.error('RP install failed:', result.error);
              btn.innerHTML = '<i class="ri-error-warning-line"></i> ' + (result.error || 'Failed');
            }
          } else { btn.innerHTML = '<i class="ri-error-warning-line"></i> No files'; }
        } catch (err) {
          console.error('RP install error:', err);
          btn.innerHTML = '<i class="ri-error-warning-line"></i> Error';
        }
        btn.disabled = false;
        setTimeout(() => { btn.innerHTML = '<i class="ri-download-line"></i> Install'; }, 3000);
      });
    });
  } catch (e) {
    console.error('Resource pack search error:', e);
    resultsEl.innerHTML = '<div class="rp-empty"><p>Failed to load resource packs: ' + escapeHtml(e.message) + '</p></div>';
  }
}

document.getElementById('rp-search-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadResourcePacks(e.target.value.trim());
});

document.getElementById('rp-open-folder')?.addEventListener('click', () => window.electronAPI.openResourcePacksFolder());

// Resource pack resolution filters
document.querySelectorAll('.rp-res-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rp-res-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const res = btn.dataset.res;
    const query = res ? `${res} resource pack` : 'resource pack';
    loadResourcePacks(query);
  });
});

// =================== MOD CONFLICT DETECTOR ===================
document.getElementById('conflict-scan-btn')?.addEventListener('click', async () => {
  const resultsEl = document.getElementById('conflict-results');
  const modListEl = document.getElementById('conflict-mod-list');
  const btn = document.getElementById('conflict-scan-btn');

  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Scanning...';

  try {
    const { mods, conflicts } = await window.electronAPI.scanModConflicts();

    if (conflicts.length === 0) {
      resultsEl.innerHTML = `
        <div class="conflict-success">
          <i class="ri-shield-check-fill"></i>
          <p>No conflicts detected! Your ${mods.length} mod(s) appear compatible.</p>
        </div>
      `;
    } else {
      resultsEl.innerHTML = `<h3 style="color:#f87171;margin-bottom:10px"><i class="ri-error-warning-fill"></i> ${conflicts.length} Conflict(s) Found</h3>` +
        conflicts.map(c => `
          <div class="conflict-item">
            <i class="ri-error-warning-fill"></i>
            <div class="conflict-info">
              <div class="conflict-mods">${escapeHtml(c.mod1)} vs ${escapeHtml(c.mod2)}</div>
              <div class="conflict-reason">${escapeHtml(c.reason)}</div>
            </div>
          </div>
        `).join('');
    }

    // Show mod list
    if (mods.length > 0) {
      modListEl.innerHTML = '<h4 style="margin:12px 0 8px;font-size:13px;color:rgba(226,221,245,0.6)">Installed Mods (' + mods.length + ')</h4>' +
        mods.map(m => `
          <div class="conflict-mod-item">
            <i class="ri-puzzle-fill"></i>
            <span>${escapeHtml(m.name)}</span>
            <span style="margin-left:auto;font-size:11px;color:rgba(226,221,245,0.3)">${formatBytes(m.size)}</span>
          </div>
        `).join('');
    } else {
      modListEl.innerHTML = '<p style="color:rgba(226,221,245,0.4);font-size:12px;padding:10px 0">No mods installed</p>';
    }
  } catch (e) {
    resultsEl.innerHTML = '<div class="conflict-empty"><p>Failed to scan mods</p></div>';
  }

  btn.innerHTML = '<i class="ri-radar-fill"></i> Scan for Conflicts';
});

// =================== MOD UPDATE CHECKER ===================
document.getElementById('update-check-btn')?.addEventListener('click', async () => {
  const resultsEl = document.getElementById('update-results');
  const btn = document.getElementById('update-check-btn');

  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Checking...';
  resultsEl.innerHTML = '<div class="update-empty"><i class="ri-loader-4-line ri-spin"></i><p>Scanning installed mods...</p></div>';

  try {
    const { mods } = await window.electronAPI.scanModConflicts();
    if (mods.length === 0) {
      resultsEl.innerHTML = '<div class="update-empty"><i class="ri-inbox-line" style="font-size:36px;display:block;margin-bottom:8px"></i><p>No mods installed to check</p></div>';
      btn.innerHTML = '<i class="ri-refresh-fill"></i> Check for Updates';
      return;
    }

    // Check each mod against Modrinth using main process IPC
    const results = [];
    for (const mod of mods) {
      const modName = mod.name.replace(/\.jar$/i, '').replace(/[-_][\d.]+.*$/, '').replace(/[-_]/g, ' ');
      try {
        const data = await modrinthSearch('mod', modName, 1);
        if (data.hits && data.hits.length > 0) {
          const hit = data.hits[0];
          results.push({ name: mod.name, modrinthName: hit.title, slug: hit.slug, hasUpdate: hit.date_modified > new Date(Date.now() - 30*24*60*60*1000).toISOString() });
        } else {
          results.push({ name: mod.name, modrinthName: null, slug: null, hasUpdate: false });
        }
      } catch (e) {
        results.push({ name: mod.name, modrinthName: null, slug: null, hasUpdate: false });
      }
    }

    resultsEl.innerHTML = results.map(r => `
      <div class="update-item">
        <i class="ri-puzzle-fill" style="color:#a78bfa"></i>
        <span class="update-mod-name">${escapeHtml(r.name)}</span>
        ${r.modrinthName ? `<span class="update-status ${r.hasUpdate ? 'outdated' : 'up-to-date'}">${r.hasUpdate ? 'Update Available' : 'Up to Date'}</span>` : '<span class="update-status" style="background:rgba(226,221,245,0.05);color:rgba(226,221,245,0.3)">Not on Modrinth</span>'}
        ${r.hasUpdate && r.slug ? `<button class="update-btn" data-slug="${r.slug}"><i class="ri-download-line"></i> Update</button>` : ''}
      </div>
    `).join('');

    resultsEl.querySelectorAll('.update-btn').forEach(btn2 => {
      btn2.addEventListener('click', async () => {
        btn2.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
        try {
          const versions = await modrinthGetVersions(btn2.dataset.slug);
          if (versions.length > 0 && versions[0].files?.length > 0) {
            const file = versions[0].files[0];
            await window.electronAPI.downloadFile(file.url, file.filename);
            btn2.innerHTML = '<i class="ri-check-line"></i> Updated!';
          }
        } catch (e) { btn2.innerHTML = '<i class="ri-error-warning-line"></i>'; }
      });
    });
  } catch (e) {
    resultsEl.innerHTML = '<div class="update-empty"><p>Failed to check for updates</p></div>';
  }

  btn.innerHTML = '<i class="ri-refresh-fill"></i> Check for Updates';
});

// =================== WORLD MANAGER ===================
async function loadWorlds() {
  const grid = document.getElementById('worlds-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="worlds-loading"><i class="ri-loader-4-line ri-spin"></i> Loading worlds...</div>';

  try {
    const worlds = await window.electronAPI.listWorlds();
    if (worlds.length === 0) {
      grid.innerHTML = '<div class="worlds-empty"><i class="ri-earth-line"></i><h3>No worlds found</h3><p>Play Minecraft to create your first world!</p></div>';
      return;
    }
    grid.innerHTML = worlds.map(w => `
      <div class="world-card">
        <div class="world-card-header">
          <div class="world-card-icon">
            ${w.icon ? `<img src="${w.icon}" alt="${escapeHtml(w.name)}" />` : '<i class="ri-earth-fill"></i>'}
          </div>
          <div class="world-card-info">
            <div class="world-card-name">${escapeHtml(w.name)}</div>
            <div class="world-card-meta">
              <span><i class="ri-time-line"></i> ${formatDate(w.lastPlayed)}</span>
              <span><i class="ri-hard-drive-line"></i> ${formatBytes(w.size)}</span>
            </div>
          </div>
        </div>
        <div class="world-card-actions">
          <button class="world-action-btn" data-action="rename" data-name="${escapeHtml(w.name)}"><i class="ri-pencil-line"></i> Rename</button>
          <button class="world-action-btn" data-action="duplicate" data-name="${escapeHtml(w.name)}"><i class="ri-file-copy-line"></i> Duplicate</button>
          <button class="world-action-btn" data-action="backup" data-name="${escapeHtml(w.name)}"><i class="ri-save-line"></i> Backup</button>
          <button class="world-action-btn" data-action="folder" data-name="${escapeHtml(w.name)}"><i class="ri-folder-open-line"></i> Open</button>
          <button class="world-action-btn delete" data-action="delete" data-name="${escapeHtml(w.name)}"><i class="ri-delete-bin-line"></i> Delete</button>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.world-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const name = btn.dataset.name;

        if (action === 'rename') {
          const newName = prompt('New world name:', name);
          if (newName && newName !== name) {
            const result = await window.electronAPI.renameWorld(name, newName);
            if (result.success) loadWorlds();
            else alert(result.error || 'Failed to rename');
          }
        } else if (action === 'duplicate') {
          btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
          const result = await window.electronAPI.duplicateWorld(name);
          if (result.success) loadWorlds();
          else alert(result.error || 'Failed to duplicate');
        } else if (action === 'backup') {
          btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
          const result = await window.electronAPI.backupWorld(name);
          if (result.success) { btn.innerHTML = '<i class="ri-check-line"></i> Backed up!'; setTimeout(() => { btn.innerHTML = '<i class="ri-save-line"></i> Backup'; }, 2000); }
          else alert(result.error || 'Failed to backup');
        } else if (action === 'folder') {
          await window.electronAPI.openWorldFolder(name);
        } else if (action === 'delete') {
          if (confirm(`Delete world "${name}"? This cannot be undone!`)) {
            const result = await window.electronAPI.deleteWorld(name);
            if (result.success) loadWorlds();
            else alert(result.error || 'Failed to delete');
          }
        }
      });
    });
  } catch (e) {
    grid.innerHTML = '<div class="worlds-empty"><p>Failed to load worlds</p></div>';
  }
}

document.getElementById('worlds-refresh-btn')?.addEventListener('click', () => loadWorlds());
document.getElementById('worlds-open-saves-btn')?.addEventListener('click', () => window.electronAPI.openWorldFolder(''));
document.querySelector('.nav-item[data-page="worlds"]')?.addEventListener('click', () => setTimeout(() => loadWorlds(), 100));

// =================== APP GALLERY (Screenshots & Videos) ===================
let galleryItems = [];
let galleryIndex = 0;
let galleryFilter = 'all';
let galleryRecorder = null;
let galleryRecordingTimer = null;
let galleryRecordStartTime = 0;

// Load gallery storage path
async function loadGalleryPath() {
  try {
    const galleryPath = await window.electronAPI.galleryGetPath();
    const pathText = document.getElementById('gallery-path-text');
    if (pathText) pathText.textContent = galleryPath;
  } catch (e) {}
}

async function loadGallery() {
  const grid = document.getElementById('gallery-grid');
  const countEl = document.getElementById('gallery-count');
  if (!grid) return;
  grid.innerHTML = '<div class="gallery-loading"><i class="ri-loader-4-line ri-spin"></i> Loading media...</div>';
  loadGalleryPath();

  try {
    let allItems = await window.electronAPI.galleryList();
    // Also merge MC screenshots
    try {
      const mcScreenshots = await window.electronAPI.listScreenshots();
      for (const s of mcScreenshots) {
        s.type = 'image';
        allItems.push(s);
      }
    } catch (e) {}
    // Sort by date newest first
    allItems.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Apply filter
    if (galleryFilter === 'images') allItems = allItems.filter(i => i.type === 'image');
    else if (galleryFilter === 'videos') allItems = allItems.filter(i => i.type === 'video');

    galleryItems = allItems;
    if (countEl) countEl.textContent = `${galleryItems.length} item${galleryItems.length !== 1 ? 's' : ''}`;

    if (galleryItems.length === 0) {
      grid.innerHTML = '<div class="gallery-empty"><i class="ri-image-line"></i><h3>No media yet</h3><p>Press <kbd>Ctrl+P</kbd> to screenshot or <kbd>Ctrl+Shift+V</kbd> to record</p></div>';
      return;
    }

    grid.innerHTML = galleryItems.map((s, i) => `
      <div class="gallery-item ${s.type === 'video' ? 'video-item' : ''}" data-index="${i}" data-path="${escapeHtml(s.path)}" data-type="${s.type}">
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(139,92,246,0.05)">
          <i class="${s.type === 'video' ? 'ri-video-fill' : 'ri-image-line'}" style="font-size:24px;color:rgba(167,139,250,0.3)"></i>
        </div>
        ${s.type === 'video' ? '<div class="gallery-video-badge"><i class="ri-play-fill"></i></div>' : ''}
        <div class="gallery-item-overlay">
          <div>${escapeHtml(s.name)}</div>
          <div>${formatDate(s.date)}</div>
        </div>
      </div>
    `).join('');

    // Lazy load thumbnails for images
    grid.querySelectorAll('.gallery-item').forEach(async (item) => {
      const p = item.dataset.path;
      const type = item.dataset.type;
      if (type === 'image') {
        try {
          // Try app gallery first, then MC screenshots
          let imgData = await window.electronAPI.galleryGetMedia(p);
          if (!imgData) imgData = await window.electronAPI.getScreenshotImage(p);
          if (imgData) {
            const placeholder = item.querySelector('div');
            if (placeholder) {
              const img = document.createElement('img');
              img.src = imgData;
              img.alt = 'Screenshot';
              item.replaceChild(img, placeholder);
            }
          }
        } catch (e) {}
      }
    });

    grid.querySelectorAll('.gallery-item').forEach(item => {
      item.addEventListener('click', () => {
        galleryIndex = parseInt(item.dataset.index);
        openGalleryLightbox(galleryIndex);
      });
    });
  } catch (e) {
    grid.innerHTML = '<div class="gallery-empty"><p>Failed to load media</p></div>';
  }
}

async function openGalleryLightbox(index) {
  if (index < 0 || index >= galleryItems.length) return;
  galleryIndex = index;
  const s = galleryItems[index];
  const lightbox = document.getElementById('gallery-lightbox');
  const img = document.getElementById('gallery-lb-img');
  const video = document.getElementById('gallery-lb-video');
  const nameEl = document.getElementById('gallery-lb-name');
  const dateEl = document.getElementById('gallery-lb-date');

  lightbox.classList.remove('hidden');
  nameEl.textContent = s.name;
  dateEl.textContent = formatDate(s.date);

  if (s.type === 'video') {
    img.classList.add('hidden');
    video.classList.remove('hidden');
    try {
      const mediaData = await window.electronAPI.galleryGetMedia(s.path);
      if (mediaData) { video.src = mediaData; video.play(); }
    } catch (e) {}
  } else {
    video.classList.add('hidden');
    video.pause();
    img.classList.remove('hidden');
    try {
      let mediaData = await window.electronAPI.galleryGetMedia(s.path);
      if (!mediaData) mediaData = await window.electronAPI.getScreenshotImage(s.path);
      if (mediaData) img.src = mediaData;
    } catch (e) {}
  }
}

function closeGalleryLightbox() {
  document.getElementById('gallery-lightbox')?.classList.add('hidden');
  const video = document.getElementById('gallery-lb-video');
  if (video) video.pause();
}

document.getElementById('gallery-lb-close')?.addEventListener('click', closeGalleryLightbox);
document.getElementById('gallery-lb-prev')?.addEventListener('click', () => openGalleryLightbox(galleryIndex - 1));
document.getElementById('gallery-lb-next')?.addEventListener('click', () => openGalleryLightbox(galleryIndex + 1));
document.getElementById('gallery-lb-delete')?.addEventListener('click', async () => {
  if (galleryIndex < 0 || galleryIndex >= galleryItems.length) return;
  const s = galleryItems[galleryIndex];
  if (confirm('Delete this item?')) {
    await window.electronAPI.galleryDelete(s.path);
    // Also try MC screenshots delete
    try { await window.electronAPI.deleteScreenshot(s.path); } catch (e) {}
    closeGalleryLightbox();
    loadGallery();
  }
});

// Gallery tab filter buttons
document.querySelectorAll('.gallery-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.gallery-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    galleryFilter = btn.dataset.tab;
    loadGallery();
  });
});

// Keyboard navigation in lightbox
document.addEventListener('keydown', (e) => {
  const lightbox = document.getElementById('gallery-lightbox');
  if (!lightbox || lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeGalleryLightbox();
  if (e.key === 'ArrowLeft') openGalleryLightbox(galleryIndex - 1);
  if (e.key === 'ArrowRight') openGalleryLightbox(galleryIndex + 1);
});

document.getElementById('gallery-refresh-btn')?.addEventListener('click', () => loadGallery());
document.getElementById('gallery-open-folder-btn')?.addEventListener('click', () => window.electronAPI.galleryOpenFolder());
document.getElementById('gallery-path-open')?.addEventListener('click', () => window.electronAPI.galleryOpenFolder());
document.querySelector('.nav-item[data-page="gallery"]')?.addEventListener('click', () => setTimeout(() => loadGallery(), 100));

// Listen for new captures
window.electronAPI.onGalleryCaptureDone?.((data) => {
  // If on gallery page, refresh
  const galleryPage = document.getElementById('page-gallery');
  if (galleryPage && galleryPage.classList.contains('active')) {
    loadGallery();
  }
});

// =================== VIDEO AREA SELECTION & RECORDING ===================
let _videoSelectMcRunning = false;

window.electronAPI.onGalleryStartVideoSelect?.((data) => {
  _videoSelectMcRunning = !!(data && data.mcRunning);
  showVideoSelectOverlay();
});

function showVideoSelectOverlay() {
  const overlay = document.getElementById('gallery-video-select-overlay');
  const canvas = document.getElementById('gallery-video-select-canvas');
  if (!overlay || !canvas) return;

  overlay.classList.remove('hidden');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Update info text if MC is running
  const infoP = overlay.querySelector('.gallery-video-select-info p');
  if (infoP) {
    infoP.textContent = _videoSelectMcRunning
      ? 'Select the area to record (will capture the screen including Minecraft)'
      : 'Click and drag to select the area to record';
  }

  let startX, startY, selecting = false;

  const onMouseDown = (e) => {
    if (e.target.closest('.gallery-video-select-info')) return;
    startX = e.clientX;
    startY = e.clientY;
    selecting = true;
  };

  const onMouseMove = (e) => {
    if (!selecting) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    ctx.clearRect(x, y, w, h);
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#a78bfa';
    ctx.font = '12px sans-serif';
    ctx.setLineDash([]);
    ctx.fillText(`${w} x ${h}`, x + 4, y - 6);
  };

  const onMouseUp = (e) => {
    if (!selecting) return;
    selecting = false;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    overlay.classList.add('hidden');

    if (w > 20 && h > 20) {
      startVideoRecording({ x, y, width: w, height: h }, _videoSelectMcRunning);
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
}

document.getElementById('gallery-video-cancel')?.addEventListener('click', () => {
  document.getElementById('gallery-video-select-overlay')?.classList.add('hidden');
});

async function startVideoRecording(area, mcRunning) {
  const recordingBar = document.getElementById('gallery-recording-bar');
  const timeEl = document.getElementById('gallery-recording-time');

  try {
    // Get screen sources — prefer MC window when MC is running, else use primary screen
    const sources = await window.electronAPI.getScreenSources();
    let sourceId = null;

    if (mcRunning && sources && sources.length > 0) {
      // Find the Minecraft / Java window
      const mcSource = sources.find(s =>
        s.name.toLowerCase().includes('minecraft') ||
        (s.name.toLowerCase().includes('java') && !s.name.toLowerCase().includes('javascript'))
      );
      if (mcSource) {
        sourceId = mcSource.id;
      }
    }

    // Fallback: use primary screen
    if (!sourceId && sources && sources.length > 0) {
      const screenSource = sources.find(s => s.id.startsWith('screen:'));
      sourceId = screenSource ? screenSource.id : sources[0].id;
    }

    if (!sourceId) {
      console.error('No capture source found');
      return;
    }

    // Get the capture stream using the desktop source
    const captureStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 3840,
          minHeight: 720,
          maxHeight: 2160
        }
      }
    });

    if (!captureStream) {
      console.error('Could not get screen capture stream');
      return;
    }

    // If MC is running, minimize the launcher so it doesn't block the capture
    if (mcRunning) {
      try { await window.electronAPI.minimizeToTray(); } catch (e) {}
    }

    // Create a canvas to crop the selected area from the full screen stream
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = area.width;
    cropCanvas.height = area.height;
    const cropCtx = cropCanvas.getContext('2d');
    const videoEl = document.createElement('video');
    videoEl.srcObject = captureStream;
    await videoEl.play();

    const croppedStream = cropCanvas.captureStream(30);
    const chunks = [];

    // Try vp9 first, fallback to vp8
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    galleryRecorder = new MediaRecorder(croppedStream, { mimeType });

    galleryRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    galleryRecorder.onstop = async () => {
      captureStream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: 'video/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      await window.electronAPI.gallerySaveVideo(new Uint8Array(arrayBuffer));
      recordingBar?.classList.add('hidden');
      clearInterval(galleryRecordingTimer);
      // Restore launcher if it was hidden
      if (mcRunning) {
        try { await window.electronAPI.restoreWindow(); } catch (e) {}
      }
      loadGallery();
    };

    // Scale the capture area — the video stream may be a different resolution than screen pixels
    const streamWidth = captureStream.getVideoTracks()[0].getSettings().width || videoEl.videoWidth || 1920;
    const streamHeight = captureStream.getVideoTracks()[0].getSettings().height || videoEl.videoHeight || 1080;
    const scaleX = streamWidth / window.screen.width;
    const scaleY = streamHeight / window.screen.height;

    const drawFrame = () => {
      if (galleryRecorder && galleryRecorder.state === 'recording') {
        const sx = area.x * scaleX;
        const sy = area.y * scaleY;
        const sw = area.width * scaleX;
        const sh = area.height * scaleY;
        cropCtx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, area.width, area.height);
        requestAnimationFrame(drawFrame);
      }
    };

    galleryRecorder.start(100);
    galleryRecordStartTime = Date.now();

    // Show the recording bar (restore launcher briefly to show it if MC was running)
    if (mcRunning) {
      // Use a floating notification instead since launcher is hidden
      // The bar will show when user restores the launcher
    }
    recordingBar?.classList.remove('hidden');

    galleryRecordingTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - galleryRecordStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      if (timeEl) timeEl.textContent = `${mins}:${secs}`;
    }, 1000);

    requestAnimationFrame(drawFrame);
  } catch (e) {
    console.error('Failed to start recording:', e);
    recordingBar?.classList.add('hidden');
  }
}

document.getElementById('gallery-stop-recording')?.addEventListener('click', () => {
  if (galleryRecorder && galleryRecorder.state === 'recording') {
    galleryRecorder.stop();
    galleryRecorder = null;
  }
});

// Also allow stopping recording with Ctrl+Shift+V again (toggle)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'V') {
    if (galleryRecorder && galleryRecorder.state === 'recording') {
      galleryRecorder.stop();
      galleryRecorder = null;
    }
  }
});

// =================== LAUNCHER THEMES ===================
async function loadTheme() {
  try {
    const theme = await window.electronAPI.getTheme();
    applyTheme(theme || 'dark');
    document.querySelectorAll('.theme-card').forEach(card => {
      card.classList.toggle('active', card.dataset.theme === (theme || 'dark'));
    });
  } catch (e) {}
}

function applyTheme(theme) {
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
  if (theme && theme !== 'dark') {
    document.body.classList.add('theme-' + theme);
  }
}

document.querySelectorAll('.theme-card').forEach(card => {
  card.addEventListener('click', async () => {
    document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    const theme = card.dataset.theme;
    applyTheme(theme);
    await window.electronAPI.setTheme(theme);
  });
});

document.getElementById('theme-accent-color')?.addEventListener('input', (e) => {
  const color = e.target.value;
  document.getElementById('theme-accent-label').textContent = color;
  document.documentElement.style.setProperty('--accent-color', color);
  window.electronAPI.setCustomTheme({ accent: color });
});

document.getElementById('theme-reset-btn')?.addEventListener('click', () => {
  const picker = document.getElementById('theme-accent-color');
  if (picker) picker.value = '#8b5cf6';
  document.getElementById('theme-accent-label').textContent = '#8b5cf6';
  document.documentElement.style.removeProperty('--accent-color');
  window.electronAPI.setCustomTheme(null);
});

// Load theme on startup
setTimeout(() => loadTheme(), 200);

// =================== PERFORMANCE ANALYZER ===================
document.getElementById('perf-analyze-btn')?.addEventListener('click', async () => {
  const resultsEl = document.getElementById('perf-results');
  const sysEl = document.getElementById('perf-system-info');
  const mcEl = document.getElementById('perf-mc-info');
  const recEl = document.getElementById('perf-recommendations');
  const btn = document.getElementById('perf-analyze-btn');

  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Analyzing...';

  try {
    const data = await window.electronAPI.analyzePerformance();
    resultsEl.classList.remove('hidden');

    sysEl.innerHTML = `
      <h4><i class="ri-computer-fill"></i> System</h4>
      <div class="perf-stat"><span>CPU</span><span class="stat-value">${escapeHtml(data.system.cpuModel)}</span></div>
      <div class="perf-stat"><span>Cores</span><span class="stat-value">${data.system.cpuCores}</span></div>
      <div class="perf-stat"><span>Total RAM</span><span class="stat-value">${data.system.totalRam} GB</span></div>
      <div class="perf-stat"><span>Free RAM</span><span class="stat-value">${data.system.freeRam} GB</span></div>
      <div class="perf-stat"><span>Platform</span><span class="stat-value">${data.system.platform} ${data.system.arch}</span></div>
    `;

    mcEl.innerHTML = `
      <h4><i class="ri-gamepad-fill"></i> Minecraft</h4>
      <div class="perf-stat"><span>Allocated RAM</span><span class="stat-value">${data.minecraft.allocatedRam} GB</span></div>
      <div class="perf-stat"><span>FPS Boost</span><span class="stat-value">${data.minecraft.fpsBoost ? 'Enabled' : 'Disabled'}</span></div>
      <div class="perf-stat"><span>Boost Profile</span><span class="stat-value">${data.minecraft.boostProfile}</span></div>
      <div class="perf-stat"><span>Installed Mods</span><span class="stat-value">${data.minecraft.modCount}</span></div>
      <div class="perf-stat"><span>Custom JVM Args</span><span class="stat-value">${data.minecraft.jvmArgs ? 'Yes' : 'No'}</span></div>
    `;

    const icons = { info: 'ri-information-fill', warning: 'ri-error-warning-fill', error: 'ri-close-circle-fill', success: 'ri-checkbox-circle-fill' };
    recEl.innerHTML = '<h4 style="margin-bottom:8px;font-size:13px;color:rgba(226,221,245,0.7)">Recommendations</h4>' +
      data.recommendations.map(r => `
        <div class="perf-rec ${r.type}">
          <i class="${icons[r.type] || 'ri-information-fill'}"></i>
          <span>${escapeHtml(r.text)}</span>
        </div>
      `).join('');
  } catch (e) {
    resultsEl.innerHTML = '<p style="color:rgba(226,221,245,0.4)">Failed to analyze performance</p>';
    resultsEl.classList.remove('hidden');
  }

  btn.innerHTML = '<i class="ri-radar-fill"></i> Analyze Performance';
});

// =================== TUTORIAL HUB ===================
const tutorialContent = {
  'getting-started': {
    title: 'Getting Started with VDeX Launcher',
    content: `
      <h2>Welcome to VDeX Launcher!</h2>
      <p>VDeX Launcher is your all-in-one Minecraft platform. Here's how to get started:</p>
      <h3>1. Select Your Minecraft Version</h3>
      <p>On the Home page, choose your mod loader (Vanilla, Forge, Fabric, or Quilt) and select a Minecraft version from the dropdown.</p>
      <h3>2. Download & Play</h3>
      <p>Click the Download button to install the selected version. Once downloaded, click Play to launch Minecraft.</p>
      <h3>3. Set Your Username</h3>
      <p>In offline mode, enter your preferred username in the text field. This is the name you'll appear as in-game.</p>
      <div class="tip-box">Tip: Use the Chat tab to connect with friends, create groups, and start voice calls while playing!</div>
      <h3>4. Explore Features</h3>
      <ul>
        <li><strong>Mods</strong> - Browse and install mods from Modrinth and CurseForge</li>
        <li><strong>Shaders</strong> - Make your game look stunning with shader packs</li>
        <li><strong>Servers</strong> - Find and join popular Minecraft servers</li>
        <li><strong>Worlds</strong> - Manage, backup, and organize your worlds</li>
        <li><strong>Gallery</strong> - View your Minecraft screenshots</li>
      </ul>
    `
  },
  'install-mods': {
    title: 'Installing Mods',
    content: `
      <h2>How to Install Mods</h2>
      <h3>Step 1: Install a Mod Loader</h3>
      <p>Before installing mods, you need a mod loader. Go to the Home page and select either <strong>Forge</strong> or <strong>Fabric</strong> as your loader.</p>
      <h3>Step 2: Download the Loader</h3>
      <p>Select your Minecraft version, then click Download. VDeX will automatically install the mod loader for you.</p>
      <h3>Step 3: Browse Mods</h3>
      <p>Go to the Mods tab and search for mods. You can filter by loader type (Forge/Fabric) and Minecraft version.</p>
      <h3>Step 4: Install Mods</h3>
      <p>Click on a mod to see available versions, then click Download on the version compatible with your setup.</p>
      <div class="tip-box">Tip: Use the Mod Conflict Detector tab to check if your installed mods are compatible with each other!</div>
      <h3>Step 5: Launch Minecraft</h3>
      <p>Go back to the Home page and click Play. Your mods will automatically be loaded.</p>
    `
  },
  'install-shaders': {
    title: 'Installing Shaders',
    content: `
      <h2>Making Minecraft Beautiful with Shaders</h2>
      <h3>Requirements</h3>
      <ul>
        <li>A mod loader (Fabric recommended)</li>
        <li>Iris Shaders mod (for Fabric) or OptiFine (for Forge)</li>
        <li>A decent GPU for best results</li>
      </ul>
      <h3>Step 1: Install Iris or OptiFine</h3>
      <p>Go to Mods tab and search for "Iris Shaders" (Fabric) or "OptiFine" (Forge). Install it.</p>
      <h3>Step 2: Browse Shaders</h3>
      <p>Go to the Shaders tab in the Mods page. Browse popular shader packs and click Install.</p>
      <h3>Step 3: Enable in Game</h3>
      <p>Launch Minecraft, go to Options > Video Settings > Shader Packs, and select your installed shader.</p>
      <div class="tip-box">Tip: Start with "Low Impact" shaders if your PC struggles with performance. BSL and Complementary are great balanced options!</div>
    `
  },
  'forge-fabric': {
    title: 'Forge vs Fabric',
    content: `
      <h2>Understanding Mod Loaders</h2>
      <h3>What is Forge?</h3>
      <p>Forge is the original Minecraft mod loader. It has the largest mod library and supports most popular mods. Best for modpacks and large mod collections.</p>
      <h3>What is Fabric?</h3>
      <p>Fabric is a lightweight, modern mod loader. It loads faster and is preferred for performance mods. Great for vanilla+ gameplay.</p>
      <h3>Key Differences</h3>
      <ul>
        <li><strong>Compatibility</strong>: Forge mods don't work with Fabric and vice versa</li>
        <li><strong>Performance</strong>: Fabric is generally lighter and faster to load</li>
        <li><strong>Mod Count</strong>: Forge has more mods overall, but Fabric is catching up</li>
        <li><strong>Updates</strong>: Fabric updates to new MC versions faster</li>
      </ul>
      <div class="tip-box">Tip: If you want Sodium + Iris for performance and shaders, use Fabric. If you want big modpacks like RLCraft, use Forge.</div>
    `
  },
  'server-setup': {
    title: 'Setting Up Servers',
    content: `
      <h2>Playing on Minecraft Servers</h2>
      <h3>Joining a Server</h3>
      <ol>
        <li>Go to the Servers tab</li>
        <li>Use the Server Finder to browse popular servers</li>
        <li>Click "Join Server" to launch Minecraft and connect directly</li>
        <li>Or copy the server address and add it manually in Minecraft</li>
      </ol>
      <h3>Creating Your Own Server</h3>
      <ol>
        <li>Go to the Servers tab and click "Aternos Panel"</li>
        <li>Create a free account on Aternos</li>
        <li>Configure your server settings and start it</li>
        <li>Share the server address with your friends</li>
      </ol>
      <div class="tip-box">Tip: Aternos servers are free but have a queue. For always-on servers, consider paid hosting options.</div>
    `
  },
  'optimize-fps': {
    title: 'Optimize FPS',
    content: `
      <h2>Improving Minecraft Performance</h2>
      <h3>1. Enable FPS Boost</h3>
      <p>Go to Settings and enable FPS Boost. Choose "Max FPS" for aggressive optimization or "Balanced" for a good middle ground.</p>
      <h3>2. Allocate More RAM</h3>
      <p>In Settings > Java & Memory, increase RAM allocation. 4GB is recommended for modded, 2GB for vanilla.</p>
      <h3>3. Install Performance Mods</h3>
      <ul>
        <li><strong>Sodium</strong> (Fabric) - Massive FPS improvement</li>
        <li><strong>Lithium</strong> (Fabric) - Server-side optimization</li>
        <li><strong>Starlight</strong> (Fabric/Forge) - Lighting engine rewrite</li>
        <li><strong>OptiFine</strong> (Forge) - All-in-one optimization</li>
      </ul>
      <h3>4. Use the Performance Analyzer</h3>
      <p>Go to Settings and click "Analyze Performance" to get personalized recommendations.</p>
      <div class="tip-box">Tip: Don't allocate more than 75% of your system RAM to Minecraft - leave room for your OS and other applications!</div>
    `
  },
  'backup-worlds': {
    title: 'Backup Worlds',
    content: `
      <h2>Keeping Your Worlds Safe</h2>
      <h3>Why Backup?</h3>
      <p>World corruption, accidental deletion, or failed mod updates can destroy hours of work. Regular backups keep your worlds safe.</p>
      <h3>How to Backup</h3>
      <ol>
        <li>Go to the Worlds tab</li>
        <li>Find the world you want to backup</li>
        <li>Click the "Backup" button</li>
        <li>Your backup is saved in the backups folder</li>
      </ol>
      <h3>Other World Actions</h3>
      <ul>
        <li><strong>Rename</strong> - Change the world's folder name</li>
        <li><strong>Duplicate</strong> - Create a copy to experiment with</li>
        <li><strong>Open Folder</strong> - Access world files directly</li>
      </ul>
      <div class="tip-box">Tip: Always backup your world before installing new mods or updating Minecraft versions!</div>
    `
  },
  'fix-crashes': {
    title: 'Fix Crashes',
    content: `
      <h2>Troubleshooting Minecraft Crashes</h2>
      <h3>Common Causes</h3>
      <ul>
        <li><strong>Mod conflicts</strong> - Incompatible mods crash the game</li>
        <li><strong>Wrong Java version</strong> - MC 1.17+ needs Java 17+</li>
        <li><strong>Not enough RAM</strong> - Modded MC needs more memory</li>
        <li><strong>Outdated drivers</strong> - GPU drivers need updating</li>
      </ul>
      <h3>Using Smart Fix</h3>
      <p>When Minecraft crashes, VDeX shows a crash banner. Click "Smart Fix" to let AI analyze the crash log and suggest fixes.</p>
      <h3>Manual Troubleshooting</h3>
      <ol>
        <li>Check the Logs panel for error messages</li>
        <li>Use the Mod Conflict Detector to find incompatible mods</li>
        <li>Try removing recently added mods one by one</li>
        <li>Verify Java is installed correctly in Settings</li>
        <li>Try allocating more RAM in Settings</li>
      </ol>
      <div class="tip-box">Tip: If all else fails, try launching vanilla Minecraft first to confirm the base game works, then add mods back one at a time.</div>
    `
  }
};

document.querySelectorAll('.tutorial-card').forEach(card => {
  card.addEventListener('click', () => {
    const tutorialId = card.dataset.tutorial;
    const tutorial = tutorialContent[tutorialId];
    if (!tutorial) return;

    const detailEl = document.getElementById('tutorial-detail');
    const gridEl = document.getElementById('tutorial-grid');
    const contentEl = document.getElementById('tutorial-detail-content');

    gridEl.style.display = 'none';
    detailEl.classList.remove('hidden');
    contentEl.innerHTML = tutorial.content;
  });
});

document.getElementById('tutorial-back-btn')?.addEventListener('click', () => {
  document.getElementById('tutorial-detail')?.classList.add('hidden');
  document.getElementById('tutorial-grid').style.display = '';
});
