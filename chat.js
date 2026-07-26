import { auth, db, rtdb } from './firebase-config.js';
import {
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp,
  doc, updateDoc, getDoc, setDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import {
  ref, set, onValue, remove, push, onChildAdded, off, get
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-database.js';
import { getChatId } from './friends.js';

let messagesUnsubscribe = null;
let currentChatFriend = null;
let localStream = null;
let peerConnection = null;
let currentCallId = null;
let callListenerUnsub = null;
let currentUsername = null;
let ringtoneCtx = null;
let ringtoneOsc = null;
let ringtoneGain = null;
let ringtoneInterval = null;
let incomingCallsActive = false;
let isInCall = false;
let callTimerInterval = null;
let callStartTime = null;
let typingTimeout = null;
let typingListenerUnsub = null;
let chatPageMessagesUnsub = null;
let currentChatPageFriend = null;
let currentChatPageChatId = null;
let isScreenSharing = false;
let localVideoStream = null;
let replyingToMessage = null;

// Group call state
let groupCallPeers = {}; // { peerId: RTCPeerConnection }
let groupCallId = null;
let groupCallGroupId = null;
let groupCallListenerUnsub = null;
let groupCallParticipantsUnsub = null;

// Helper: detect emoji-only messages
function isEmojiOnly(text) {
  const emojiRegex = /^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Component}\u200d\ufe0f\s]{1,10}$/u;
  return emojiRegex.test(text.trim()) && text.trim().length <= 20;
}

// Helper: format message timestamp
function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday ? time : `${date.toLocaleDateString()} ${time}`;
}

// Set the current user's username for call display
export function setCurrentUsername(username) {
  currentUsername = username;
}

// =================== RINGTONE (Web Audio API) ===================
function startRingtone(type = 'outgoing') {
  stopRingtone();
  try {
    ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)();

    const playTone = () => {
      if (!ringtoneCtx || ringtoneCtx.state === 'closed') return;
      const now = ringtoneCtx.currentTime;

      if (type === 'incoming') {
        // Melodic ascending chime — C5 E5 G5 C6 with harmonics
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, i) => {
          const osc = ringtoneCtx.createOscillator();
          const osc2 = ringtoneCtx.createOscillator();
          const gain = ringtoneCtx.createGain();
          const filter = ringtoneCtx.createBiquadFilter();

          osc.type = 'sine';
          osc2.type = 'triangle';
          osc.frequency.value = freq;
          osc2.frequency.value = freq * 2; // octave harmonic

          filter.type = 'lowpass';
          filter.frequency.value = 3000;
          filter.Q.value = 2;

          osc.connect(gain);
          osc2.connect(gain);
          gain.connect(filter);
          filter.connect(ringtoneCtx.destination);

          const start = now + i * 0.15;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.18, start + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);

          osc.start(start);
          osc.stop(start + 0.55);
          osc2.start(start);
          osc2.stop(start + 0.55);
        });

        // Soft reverb shimmer on the last note
        const shimmer = ringtoneCtx.createOscillator();
        const shimGain = ringtoneCtx.createGain();
        shimmer.type = 'sine';
        shimmer.frequency.value = 1046.50;
        shimmer.connect(shimGain);
        shimGain.connect(ringtoneCtx.destination);
        const sStart = now + 0.6;
        shimGain.gain.setValueAtTime(0.08, sStart);
        shimGain.gain.exponentialRampToValueAtTime(0.001, sStart + 0.8);
        shimmer.start(sStart);
        shimmer.stop(sStart + 0.85);
      } else {
        // Outgoing: smooth pulsing tone — two soft notes like Discord/WhatsApp
        [0, 0.6].forEach((offset, idx) => {
          const osc = ringtoneCtx.createOscillator();
          const osc2 = ringtoneCtx.createOscillator();
          const gain = ringtoneCtx.createGain();

          osc.type = 'sine';
          osc2.type = 'sine';
          osc.frequency.value = idx === 0 ? 392.00 : 440.00; // G4, A4
          osc2.frequency.value = (idx === 0 ? 392.00 : 440.00) * 1.5; // fifth

          osc.connect(gain);
          osc2.connect(gain);
          gain.connect(ringtoneCtx.destination);

          const t = now + offset;
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.15, t + 0.06);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

          osc.start(t);
          osc.stop(t + 0.5);
          osc2.start(t);
          osc2.stop(t + 0.5);
        });
      }
    };

    playTone();
    ringtoneInterval = setInterval(playTone, type === 'incoming' ? 2000 : 3000);
    console.log('[CALL] Ringtone started:', type);
  } catch (e) {
    console.error('[CALL] Ringtone error:', e);
  }
}

function stopRingtone() {
  if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
  if (ringtoneCtx && ringtoneCtx.state !== 'closed') {
    ringtoneCtx.close().catch(() => {});
  }
  ringtoneCtx = null;
  ringtoneOsc = null;
  ringtoneGain = null;
}

// Start listening for incoming calls globally (called once on auth)
export function initCallListener() {
  if (incomingCallsActive) return;
  incomingCallsActive = true;
  console.log('[CALL] Global incoming call listener started');
  setupGlobalCallListener();
  setupOverlayActionListener();
}

// Listen for actions from the overlay window (relayed through main process)
function setupOverlayActionListener() {
  window.electronAPI.onOverlayAction((data) => {
    console.log('[OVERLAY] Action received:', data.action);
    if (data.action === 'toggle-mute') {
      const isMuted = toggleMute();
      // Update mini bar mute button
      const muteBtn = document.getElementById('call-mini-mute');
      if (muteBtn) {
        muteBtn.classList.toggle('active', isMuted);
        const icon = muteBtn.querySelector('i');
        if (icon) icon.className = isMuted ? 'ri-mic-off-line' : 'ri-mic-line';
      }
      // Sync mute state back to overlay
      try { window.electronAPI.syncOverlayMute(isMuted); } catch (e) {}
    } else if (data.action === 'end-call') {
      endCall();
    } else if (data.action === 'send-message') {
      sendMessage(data.text);
    }
  });
}

function setupGlobalCallListener() {
  const callsRef = ref(rtdb, '/calls');
  onValue(callsRef, (snapshot) => {
    const calls = snapshot.val();
    if (!calls || !auth.currentUser) return;

    const myUid = auth.currentUser.uid;

    Object.entries(calls).forEach(([callId, callData]) => {
      // Only handle calls TO me that are ringing, and I'm not already in a call
      if (callData.to === myUid && callData.status === 'ringing' && !isInCall && currentCallId !== callId) {
        console.log('[CALL] Incoming call detected:', callId, 'from:', callData.fromUsername);
        showIncomingCall(callId, callData);
      }
    });
  }, (error) => {
    console.error('[CALL] Error listening for calls:', error);
  });
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Open chat with a friend
export function openChat(friend) {
  currentChatFriend = friend;
  const chatArea = document.getElementById('chat-area');
  const emptyChat = document.getElementById('empty-chat');

  if (emptyChat) emptyChat.classList.add('hidden');
  if (chatArea) chatArea.classList.remove('hidden');

  document.getElementById('chat-friend-name').textContent = friend.username;
  document.getElementById('chat-friend-status').textContent = friend.online ? 'Online' : 'Offline';
  document.getElementById('chat-friend-status').className = `chat-status ${friend.online ? 'online' : 'offline'}`;

  loadMessages(friend.uid);
  // Don't call listenForIncomingCalls here — it's global now via initCallListener
}

// Load and listen for messages
function loadMessages(friendUid) {
  if (messagesUnsubscribe) messagesUnsubscribe();

  const chatId = getChatId(auth.currentUser.uid, friendUid);
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));

  const messagesContainer = document.getElementById('chat-messages');
  messagesContainer.innerHTML = '';

  messagesUnsubscribe = onSnapshot(q, (snapshot) => {
    messagesContainer.innerHTML = '';
    snapshot.forEach(msgDoc => {
      const msg = msgDoc.data();
      const msgId = msgDoc.id;

      // Build reactions HTML
      let reactionsHtml = '';
      if (msg.reactions && Object.keys(msg.reactions).length > 0) {
        const uid = auth.currentUser.uid;
        reactionsHtml = '<div class="message-reactions">' +
          Object.entries(msg.reactions).map(([emoji, users]) => {
            const isMineReaction = users.includes(uid);
            return `<span class="reaction-badge ${isMineReaction ? 'mine' : ''}" data-msg-id="${msgId}" data-emoji="${emoji}">${emoji}<span class="reaction-count">${users.length}</span></span>`;
          }).join('') +
          '</div>';
      }

      const msgEl = document.createElement('div');
      msgEl.className = 'msg-message';
      msgEl.dataset.msgId = msgId;
      msgEl.dataset.senderUid = msg.sender || msg.senderId || '';
      msgEl.innerHTML = `
        <div class="msg-message-avatar"><i class="ri-user-fill"></i></div>
        <div class="msg-message-body">
          ${msg.replyTo ? `<div class="msg-message-reply" data-reply-id="${msg.replyTo}"><i class="ri-reply-line"></i> ${escapeHtml(msg.replyToText || 'message')}</div>` : ''}
          <div class="msg-message-header">
            <span class="msg-message-sender">${escapeHtml(msg.senderName || 'Unknown')}</span>
            <span class="msg-message-time">${formatMessageTime(msg.timestamp || msg.createdAt)}</span>
          </div>
          <div class="msg-message-text ${isEmojiOnly(msg.text) ? 'emoji-only' : ''}">${escapeHtml(msg.text)}${msg.edited ? '<span class="msg-edited">(edited)</span>' : ''}</div>
          ${reactionsHtml}
        </div>
        <div class="msg-message-actions">
          <button class="msg-action-tiny reply-msg-btn" data-msg-id="${msgId}" title="Reply"><i class="ri-reply-line"></i></button>
          ${(msg.sender || msg.senderId) === auth.currentUser?.uid ? `
            <button class="msg-action-tiny edit-msg-btn" data-msg-id="${msgId}" title="Edit"><i class="ri-pencil-line"></i></button>
            <button class="msg-action-tiny delete-msg-btn" data-msg-id="${msgId}" title="Delete"><i class="ri-delete-bin-line"></i></button>
          ` : ''}
          <button class="msg-action-tiny react-msg-btn" data-msg-id="${msgId}" title="React"><i class="ri-emotion-line"></i></button>
        </div>
      `;
      messagesContainer.appendChild(msgEl);
    });

    // Attach action event listeners
    messagesContainer.querySelectorAll('.reply-msg-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const msgEl = btn.closest('.msg-message');
        const msgText = msgEl?.querySelector('.msg-message-text')?.textContent || '';
        replyToMessage(btn.dataset.msgId, msgText);
      });
    });

    messagesContainer.querySelectorAll('.edit-msg-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        editMessage(btn.dataset.msgId);
      });
    });

    messagesContainer.querySelectorAll('.delete-msg-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMessage(btn.dataset.msgId);
      });
    });

    messagesContainer.querySelectorAll('.react-msg-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        reactToMessage(btn.dataset.msgId);
      });
    });

    messagesContainer.querySelectorAll('.reaction-badge').forEach(badge => {
      badge.addEventListener('click', () => {
        addReaction(badge.dataset.msgId, badge.dataset.emoji);
      });
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Sync last 20 messages to overlay window
    try {
      const overlayMsgs = [];
      snapshot.forEach(msgDoc => {
        const msg = msgDoc.data();
        overlayMsgs.push({
          isMine: msg.sender === auth.currentUser.uid,
          sender: msg.sender === auth.currentUser.uid ? 'You' : (currentChatFriend?.username || 'Friend'),
          text: msg.text
        });
      });
      window.electronAPI.syncOverlayMessages(overlayMsgs.slice(-20));
    } catch (e) {}
  });
}

// Send a message
export async function sendMessage(text) {
  if (!currentChatFriend || !text.trim()) return;

  const chatId = getChatId(auth.currentUser.uid, currentChatFriend.uid);
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    sender: auth.currentUser.uid,
    senderName: currentUsername || 'Unknown',
    text: text.trim(),
    timestamp: serverTimestamp(),
    replyTo: replyingToMessage?.id || null,
    replyToText: replyingToMessage?.text || null
  });

  // Clear reply state after sending
  replyingToMessage = null;
  const indicator = document.getElementById('reply-indicator');
  if (indicator) indicator.remove();
  const input = document.getElementById('chat-input');
  if (input) input.placeholder = 'Type a message...';
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =================== VOICE CALLS (WebRTC) ===================

// Clean up any stale calls from this user before starting
async function cleanupStaleCalls() {
  try {
    const callsSnap = await get(ref(rtdb, '/calls'));
    const calls = callsSnap.val();
    if (!calls) return;

    const myUid = auth.currentUser.uid;
    const promises = [];

    Object.entries(calls).forEach(([callId, callData]) => {
      // Remove calls I made or received that are stuck in ringing
      if ((callData.from === myUid || callData.to === myUid) &&
          (callData.status === 'ringing' || callData.status === 'ended')) {
        console.log('[CALL] Cleaning stale call:', callId);
        promises.push(remove(ref(rtdb, `/calls/${callId}`)));
      }
    });

    await Promise.all(promises);
  } catch (e) {
    console.error('[CALL] Cleanup error:', e);
  }
}

// Initiate a call
export async function startCall() {
  if (!currentChatFriend) {
    console.error('[CALL] No friend selected');
    return;
  }

  if (isInCall) {
    // Force-end stale call before starting a new one
    console.log('[CALL] Ending stale call before starting new one');
    if (groupCallId) await endGroupCall();
    else await endCall();
    isInCall = false;
    currentCallId = null;
  }

  console.log('[CALL] Starting call to:', currentChatFriend.username, '(', currentChatFriend.uid, ')');

  // Clean up stale calls first
  await cleanupStaleCalls();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[CALL] Got microphone access');
  } catch (err) {
    console.error('[CALL] Microphone denied:', err);
    alert('Microphone access denied. Please allow microphone access to make calls.');
    return;
  }

  isInCall = true;
  const callId = `${auth.currentUser.uid}_${currentChatFriend.uid}_${Date.now()}`;
  currentCallId = callId;

  peerConnection = new RTCPeerConnection(ICE_SERVERS);
  console.log('[CALL] Created peer connection');

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    console.log('[CALL] Got remote track');
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
      remoteAudio.srcObject = event.streams[0];
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      push(ref(rtdb, `/calls/${callId}/callerCandidates`))
        .then(candidateRef => set(candidateRef, event.candidate.toJSON()))
        .catch(err => console.error('[CALL] ICE candidate error:', err));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('[CALL] ICE state:', peerConnection?.iceConnectionState);
  };

  try {
    // Create offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log('[CALL] Created offer');

    // Store call in RTDB
    const callData = {
      from: auth.currentUser.uid,
      to: currentChatFriend.uid,
      fromUsername: currentUsername || 'Unknown',
      toUsername: currentChatFriend.username || 'Unknown',
      offer: { type: offer.type, sdp: offer.sdp },
      status: 'ringing',
      timestamp: Date.now()
    };

    await set(ref(rtdb, `/calls/${callId}`), callData);
    console.log('[CALL] Call written to Firebase:', callId);

    showCallUI('outgoing');
    startRingtone('outgoing');

    // Listen for answer
    const answerUnsub = onValue(ref(rtdb, `/calls/${callId}/answer`), async (snapshot) => {
      const answer = snapshot.val();
      if (answer && peerConnection && peerConnection.signalingState === 'have-local-offer') {
        console.log('[CALL] Got answer! Connecting...');
        stopRingtone();
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
          showCallUI('connected');
          console.log('[CALL] Connected!');
        } catch (err) {
          console.error('[CALL] Error setting remote desc:', err);
        }
      }
    });

    // Listen for callee ICE candidates
    onChildAdded(ref(rtdb, `/calls/${callId}/calleeCandidates`), (snapshot) => {
      if (peerConnection) {
        const candidate = new RTCIceCandidate(snapshot.val());
        peerConnection.addIceCandidate(candidate).catch(err =>
          console.error('[CALL] Error adding ICE candidate:', err)
        );
      }
    });

    // Listen for hangup/status changes
    onValue(ref(rtdb, `/calls/${callId}/status`), (snapshot) => {
      const status = snapshot.val();
      console.log('[CALL] Status changed:', status);
      if (status === 'ended' && currentCallId === callId) {
        endCall();
      }
    });

    // Auto-timeout after 30 seconds of no answer
    setTimeout(() => {
      if (currentCallId === callId && !peerConnection?.remoteDescription) {
        console.log('[CALL] Call timed out — no answer');
        endCall();
      }
    }, 30000);

  } catch (err) {
    console.error('[CALL] Error starting call:', err);
    isInCall = false;
    currentCallId = null;
    stopRingtone();
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    hideCallUI();
  }
}

// Show incoming call UI
function showIncomingCall(callId, callData) {
  // Don't re-trigger if already showing this call or in a call
  if (currentCallId === callId || isInCall) return;

  console.log('[CALL] Showing incoming call UI from:', callData.fromUsername);
  currentCallId = callId;

  const overlay = document.getElementById('call-overlay');
  const callerName = document.getElementById('call-overlay-name');

  if (overlay && callerName) {
    callerName.textContent = callData.fromUsername || 'Someone is calling';
  }

  showCallUI('incoming');
  startRingtone('incoming');

  // Send OS notification for incoming call (useful when window is hidden)
  try {
    window.electronAPI.showNotification(
      'Incoming Call',
      `${callData.fromUsername || 'Someone'} is calling you`
    );
  } catch (e) {}

  // Watch for caller hanging up
  onValue(ref(rtdb, `/calls/${callId}/status`), (snapshot) => {
    const status = snapshot.val();
    if ((status === 'ended' || status === null) && currentCallId === callId && !isInCall) {
      console.log('[CALL] Caller cancelled');
      stopRingtone();
      currentCallId = null;
      hideCallUI();
    }
  });
}

// Accept incoming call
export async function acceptCall() {
  stopRingtone();
  const callId = currentCallId;
  if (!callId) {
    console.error('[CALL] No call to accept');
    return;
  }

  console.log('[CALL] Accepting call:', callId);

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[CALL] Got microphone access');
  } catch (err) {
    console.error('[CALL] Microphone denied:', err);
    alert('Microphone access denied.');
    return;
  }

  isInCall = true;
  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    console.log('[CALL] Got remote track');
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
      remoteAudio.srcObject = event.streams[0];
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      push(ref(rtdb, `/calls/${callId}/calleeCandidates`))
        .then(candidateRef => set(candidateRef, event.candidate.toJSON()))
        .catch(err => console.error('[CALL] ICE candidate error:', err));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('[CALL] ICE state:', peerConnection?.iceConnectionState);
  };

  try {
    // Get the offer
    const callSnapshot = await get(ref(rtdb, `/calls/${callId}`));
    const callData = callSnapshot.val();

    if (!callData || !callData.offer) {
      console.error('[CALL] No offer found in call data');
      isInCall = false;
      return;
    }

    // Set the caller's username as chat friend if not set
    if (!currentChatFriend) {
      currentChatFriend = { uid: callData.from, username: callData.fromUsername || 'Unknown' };
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
    console.log('[CALL] Set remote description');

    // Listen for caller ICE candidates
    onChildAdded(ref(rtdb, `/calls/${callId}/callerCandidates`), (snapshot) => {
      if (peerConnection) {
        const candidate = new RTCIceCandidate(snapshot.val());
        peerConnection.addIceCandidate(candidate).catch(err =>
          console.error('[CALL] Error adding ICE candidate:', err)
        );
      }
    });

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log('[CALL] Created answer');

    await set(ref(rtdb, `/calls/${callId}/answer`), { type: answer.type, sdp: answer.sdp });
    await set(ref(rtdb, `/calls/${callId}/status`), 'connected');
    console.log('[CALL] Answer sent, status set to connected');

    showCallUI('connected');

    // Listen for hangup
    onValue(ref(rtdb, `/calls/${callId}/status`), (snapshot) => {
      if (snapshot.val() === 'ended' && currentCallId === callId) {
        endCall();
      }
    });
  } catch (err) {
    console.error('[CALL] Error accepting call:', err);
    isInCall = false;
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    hideCallUI();
  }
}

// Decline incoming call
export async function declineCall() {
  console.log('[CALL] Declining call');
  stopRingtone();
  if (currentCallId) {
    try {
      await set(ref(rtdb, `/calls/${currentCallId}/status`), 'ended');
    } catch (e) {
      console.error('[CALL] Error declining:', e);
    }
  }
  currentCallId = null;
  isInCall = false;
  hideCallUI();
}

// End call
export async function endCall() {
  console.log('[CALL] Ending call');
  stopRingtone();

  // Save callId before clearing
  const callIdToClean = currentCallId;

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  currentCallId = null;
  isInCall = false;

  if (callIdToClean) {
    try {
      await set(ref(rtdb, `/calls/${callIdToClean}/status`), 'ended');
    } catch (e) {
      console.error('[CALL] Error setting ended:', e);
    }
    // Clean up call data after delay
    setTimeout(async () => {
      try { await remove(ref(rtdb, `/calls/${callIdToClean}`)); } catch (e) {}
    }, 3000);
  }

  hideCallUI();
}

// Toggle mute
export function toggleMute() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // returns true if muted
    }
  }
  return false;
}

// Show call UI
function showCallUI(mode) {
  const overlay = document.getElementById('call-overlay');
  if (!overlay) return;

  // Hide all buttons first
  document.getElementById('call-accept-btn')?.classList.add('hidden');
  document.getElementById('call-decline-btn')?.classList.add('hidden');
  document.getElementById('call-mute-btn')?.classList.add('hidden');
  document.getElementById('call-hangup-btn')?.classList.add('hidden');

  overlay.classList.remove('hidden');
  overlay.dataset.mode = mode;

  if (mode === 'outgoing') {
    document.getElementById('call-overlay-name').textContent = currentChatFriend?.username || '';
    document.getElementById('call-status-text').textContent = 'Calling...';
    document.getElementById('call-hangup-btn')?.classList.remove('hidden');
  } else if (mode === 'incoming') {
    document.getElementById('call-status-text').textContent = 'Incoming call...';
    document.getElementById('call-accept-btn')?.classList.remove('hidden');
    document.getElementById('call-decline-btn')?.classList.remove('hidden');
  } else if (mode === 'connected') {
    // Hide the full overlay — show floating widget instead
    overlay.classList.add('hidden');

    const friendName = currentChatFriend?.username || 'Unknown';
    showCallWidget(friendName);
    showCallBanner(friendName);

    // Update tray status
    try { window.electronAPI.updateTrayStatus(friendName); } catch (e) {}

    // Sync call state to overlay window
    try { window.electronAPI.syncOverlayCall({ active: true, friendName }); } catch (e) {}

    // Dispatch event for app.js widget
    window.dispatchEvent(new CustomEvent('call-started', { detail: { name: friendName } }));
  }
}

function hideCallUI() {
  const overlay = document.getElementById('call-overlay');
  if (overlay) overlay.classList.add('hidden');

  hideCallWidget();
  hideCallBanner();

  // Clear tray status
  try { window.electronAPI.updateTrayStatus(null); } catch (e) {}

  // Sync to overlay window
  try { window.electronAPI.syncOverlayCall({ active: false }); } catch (e) {}

  window.dispatchEvent(new CustomEvent('call-ended'));
}

// =================== FLOATING CALL WIDGET ===================
function showCallWidget(friendName) {
  const widget = document.getElementById('call-widget');
  const nameEl = document.getElementById('call-widget-name');
  const mini = document.getElementById('call-widget-mini');
  const expanded = document.getElementById('call-widget-expanded');

  if (widget) {
    widget.classList.remove('hidden');
    // Start expanded, user can minimize
    if (mini) mini.classList.add('hidden');
    if (expanded) expanded.classList.remove('hidden');
    if (nameEl) nameEl.textContent = friendName;
  }

  // Start call timer
  callStartTime = Date.now();
  if (callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    const timeStr = `${mins}:${secs}`;
    const timerMini = document.getElementById('call-widget-timer');
    const timerExp = document.getElementById('call-widget-timer-exp');
    if (timerMini) timerMini.textContent = timeStr;
    if (timerExp) timerExp.textContent = timeStr;
  }, 1000);
}

function hideCallWidget() {
  const widget = document.getElementById('call-widget');
  if (widget) widget.classList.add('hidden');
  if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
  callStartTime = null;
}

// =================== CALL BANNER ===================
export function showCallBanner(friendName) {
  const banner = document.getElementById('call-status-banner');
  const text = document.getElementById('call-status-banner-text');
  if (banner) {
    banner.classList.remove('hidden');
    if (text) text.textContent = `In call with ${friendName}`;
  }
}

export function hideCallBanner() {
  const banner = document.getElementById('call-status-banner');
  if (banner) banner.classList.add('hidden');
}

// =================== EMOJI & REACTIONS ===================

const EMOJI_LIST = [
  '😀','😃','😄','😁','😂','🤣','😅','😊',
  '😍','🥰','😘','😜','🤪','😎','🤩','🥳',
  '😭','🥺','😢','😤','😡','🤬','😈','👿',
  '💀','☠️','👻','🤡','💩','👽','🤖','😻',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍',
  '🔥','✨','💫','⭐','🌟','💯','💢','💥',
  '👍','👎','👊','✊','🤝','🙌','👏','💪',
  '🙏','🫡','✌️','🤞','🤟','🖐️','👀','👁️',
  '🎮','🎯','🏆','🎉','🎊','🎁','🎈','🪩',
  '⚔️','🗡️','🛡️','🏹','🪄','💎','👑','🔮'
];

const QUICK_REACTIONS = ['❤️', '😂', '👍', '🔥', '😍', '💯'];

// Initialize emoji picker
export function initEmojiPicker() {
  const emojiGrid = document.getElementById('emoji-grid');
  if (!emojiGrid) return;

  emojiGrid.innerHTML = EMOJI_LIST.map(e => `<span data-emoji="${e}">${e}</span>`).join('');

  emojiGrid.addEventListener('click', (e) => {
    const emoji = e.target.dataset?.emoji;
    if (!emoji) return;
    const input = document.getElementById('chat-input');
    if (input) {
      input.value += emoji;
      input.focus();
    }
  });
}

// Toggle emoji picker
export function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (picker) picker.classList.toggle('hidden');
}

// Show quick reaction picker on a message
function showReactionPicker(btnEl, msgId) {
  // Remove any existing picker
  document.querySelectorAll('.reaction-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.innerHTML = QUICK_REACTIONS.map(e => `<span data-emoji="${e}">${e}</span>`).join('');

  picker.addEventListener('click', (e) => {
    const emoji = e.target.dataset?.emoji;
    if (emoji) {
      addReaction(msgId, emoji);
      picker.remove();
    }
  });

  // Close picker on outside click
  const closeHandler = (e) => {
    if (!picker.contains(e.target)) {
      picker.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);

  btnEl.closest('.msg-message').appendChild(picker);
}

// Add reaction to a message
export async function addReaction(messageId, emoji) {
  if (!currentChatFriend) return;
  const chatId = getChatId(auth.currentUser.uid, currentChatFriend.uid);
  const msgRef = doc(db, 'chats', chatId, 'messages', messageId);

  try {
    const msgSnap = await getDoc(msgRef);
    if (!msgSnap.exists()) return;

    const data = msgSnap.data();
    const reactions = data.reactions || {};
    const uid = auth.currentUser.uid;

    // Toggle: if user already reacted with this emoji, remove it
    if (reactions[emoji] && reactions[emoji].includes(uid)) {
      reactions[emoji] = reactions[emoji].filter(id => id !== uid);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      if (!reactions[emoji]) reactions[emoji] = [];
      reactions[emoji].push(uid);
    }

    await updateDoc(msgRef, { reactions });
  } catch (err) {
    console.error('Failed to add reaction:', err);
  }
}

// =================== TYPING INDICATORS ===================

export function sendTypingIndicator() {
  if (!currentChatPageChatId || !auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const typingRef = ref(rtdb, `/typing/${currentChatPageChatId}/${uid}`);

  set(typingRef, {
    username: currentUsername || 'Unknown',
    timestamp: Date.now()
  });

  // Clear previous timeout
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    remove(typingRef).catch(() => {});
  }, 3000);
}

function listenForTyping(chatId) {
  if (typingListenerUnsub) {
    off(ref(rtdb, `/typing/${chatId}`));
  }

  const typingRef = ref(rtdb, `/typing/${chatId}`);
  onValue(typingRef, (snapshot) => {
    const typing = snapshot.val();
    const indicator = document.getElementById('msg-typing-indicator');
    if (!indicator || !auth.currentUser) return;

    if (!typing) {
      indicator.innerHTML = '';
      return;
    }

    const myUid = auth.currentUser.uid;
    const typingUsers = Object.entries(typing)
      .filter(([uid, data]) => uid !== myUid && (Date.now() - data.timestamp) < 5000)
      .map(([uid, data]) => data.username);

    if (typingUsers.length === 0) {
      indicator.innerHTML = '';
    } else if (typingUsers.length === 1) {
      indicator.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div> ${escapeHtml(typingUsers[0])} is typing...`;
    } else {
      indicator.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div> ${typingUsers.length} people are typing...`;
    }
  });

  typingListenerUnsub = () => off(typingRef);
}

// =================== READ RECEIPTS ===================

export function updateReadReceipt(chatId) {
  if (!chatId || !auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const receiptRef = ref(rtdb, `/readReceipts/${chatId}/${uid}`);
  set(receiptRef, { timestamp: Date.now() }).catch(() => {});
}

// =================== CHAT PAGE (dedicated) ===================

export function openChatPage(friend) {
  currentChatPageFriend = friend;
  const chatId = getChatId(auth.currentUser.uid, friend.uid);
  currentChatPageChatId = chatId;

  // Show active chat, hide empty state
  const emptyState = document.getElementById('chat-page-empty');
  const activeChat = document.getElementById('chat-page-active');
  if (emptyState) emptyState.classList.add('hidden');
  if (activeChat) {
    activeChat.classList.remove('hidden');
    activeChat.style.display = 'flex';
  }

  // Set header info
  document.getElementById('chat-page-name').textContent = friend.username;
  const statusEl = document.getElementById('chat-page-status');
  if (statusEl) {
    statusEl.textContent = friend.online ? 'Online' : 'Offline';
    statusEl.className = `chat-status ${friend.online ? 'online' : 'offline'}`;
  }

  // Load messages
  loadChatPageMessages(chatId);
  listenForTyping(chatId);
  updateReadReceipt(chatId);
}

function loadChatPageMessages(chatId) {
  if (chatPageMessagesUnsub) chatPageMessagesUnsub();

  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));
  const container = document.getElementById('chat-page-messages');
  if (!container) return;
  container.innerHTML = '';

  chatPageMessagesUnsub = onSnapshot(q, (snapshot) => {
    container.innerHTML = '';
    snapshot.forEach(msgDoc => {
      const msg = msgDoc.data();
      const isMine = msg.sender === auth.currentUser.uid;
      const time = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      const msgEl = document.createElement('div');
      msgEl.className = `chat-msg ${isMine ? 'sent' : 'received'}`;

      let contentHtml = '';

      if (msg.type === 'file') {
        contentHtml = `
          <div class="chat-file-attachment">
            <i class="ri-file-fill chat-file-icon"></i>
            <div class="chat-file-info">
              <div class="chat-file-name">${escapeHtml(msg.fileName || 'File')}</div>
              <div class="chat-file-size">${msg.fileSize || ''}</div>
            </div>
            <i class="ri-download-line"></i>
          </div>
        `;
      } else {
        // Check for image URLs
        const text = msg.text || '';
        const imageRegex = /(https?:\/\/\S+\.(png|jpg|jpeg|gif|webp))/gi;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        let processedText = escapeHtml(text);

        // Linkify URLs
        processedText = processedText.replace(urlRegex, '<a href="$1" style="color:#a78bfa;text-decoration:underline" target="_blank">$1</a>');

        contentHtml = `<div class="chat-msg-bubble"><p>${processedText}</p></div>`;

        // Add inline image if URL is an image
        const imageMatch = text.match(imageRegex);
        if (imageMatch) {
          contentHtml += `<img src="${imageMatch[0]}" class="chat-inline-image" alt="Image" onerror="this.style.display='none'" />`;
        }
      }

      // Read receipt for sent messages
      let receiptHtml = '';
      if (isMine) {
        receiptHtml = `<span class="message-receipts"><i class="ri-check-double-line read"></i></span>`;
      }

      msgEl.innerHTML = `
        <div class="chat-msg-content">
          ${contentHtml}
          <div class="chat-msg-meta">
            <span>${time}</span>
            ${receiptHtml}
          </div>
        </div>
      `;
      container.appendChild(msgEl);
    });
    container.scrollTop = container.scrollHeight;

    // Update read receipt
    updateReadReceipt(chatId);
  });
}

export async function sendChatPageMessage(text) {
  if (!currentChatPageFriend || !text.trim()) return;

  const chatId = getChatId(auth.currentUser.uid, currentChatPageFriend.uid);
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    sender: auth.currentUser.uid,
    text: text.trim(),
    timestamp: serverTimestamp()
  });

  // Clear typing indicator
  if (auth.currentUser) {
    remove(ref(rtdb, `/typing/${chatId}/${auth.currentUser.uid}`)).catch(() => {});
  }
}

// =================== VIDEO CALLS ===================

export async function startVideoCall() {
  if (!currentChatPageFriend && !currentChatFriend) return;
  const friend = currentChatPageFriend || currentChatFriend;

  try {
    localVideoStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

    // Add video elements to overlay if not present
    const overlay = document.getElementById('call-overlay');
    let videoContainer = overlay?.querySelector('.video-call-container');
    if (!videoContainer && overlay) {
      videoContainer = document.createElement('div');
      videoContainer.className = 'video-call-container';
      videoContainer.innerHTML = `
        <video id="remote-video" autoplay playsinline></video>
        <video id="local-video" autoplay playsinline muted class="local-video"></video>
      `;
      overlay.querySelector('.call-overlay-content')?.appendChild(videoContainer);
    }

    const localVideo = document.getElementById('local-video');
    if (localVideo) localVideo.srcObject = localVideoStream;

    // Start call with video tracks
    currentChatFriend = friend;
    await startCall();

    // Add video tracks to peer connection
    if (peerConnection && localVideoStream) {
      localVideoStream.getVideoTracks().forEach(track => {
        peerConnection.addTrack(track, localVideoStream);
      });
    }
  } catch (err) {
    console.error('[CALL] Video call error:', err);
  }
}

// =================== SCREEN SHARING ===================

export async function startScreenShare() {
  if (!isInCall) {
    console.error('[CALL] Must be in a call to screen share');
    return;
  }

  // If already sharing, stop it
  if (isScreenSharing) {
    stopScreenShare();
    return;
  }

  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: false
    });
    const screenTrack = screenStream.getVideoTracks()[0];

    if (groupCallId) {
      // Group call: add screen track to all peer connections
      for (const [peerId, pc] of Object.entries(groupCallPeers)) {
        try {
          const senders = pc.getSenders();
          const videoSender = senders.find(s => s.track?.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(screenTrack);
          } else {
            pc.addTrack(screenTrack, screenStream);
          }
        } catch (e) {
          console.error(`[SCREEN] Failed to add track to peer ${peerId}:`, e);
        }
      }

      // Show local screen share preview in the group call UI
      showScreenShareUI(screenStream, currentUsername || 'You');
    } else if (peerConnection) {
      // 1-on-1 call
      const senders = peerConnection.getSenders();
      const videoSender = senders.find(s => s.track?.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(screenTrack);
      } else {
        peerConnection.addTrack(screenTrack, screenStream);
      }
    }

    isScreenSharing = true;
    localVideoStream = screenStream;

    // Update button state
    const screenBtn = document.getElementById('gc-screen-btn');
    if (screenBtn) {
      screenBtn.classList.add('active');
      screenBtn.querySelector('i').className = 'ri-stop-circle-line';
    }

    // When user clicks "Stop sharing" in browser/OS bar
    screenTrack.onended = () => {
      stopScreenShare();
    };
  } catch (err) {
    if (err.name !== 'NotAllowedError') {
      console.error('[CALL] Screen share error:', err);
    }
  }
}

function stopScreenShare() {
  if (!isScreenSharing) return;
  isScreenSharing = false;

  // Stop all video tracks
  if (localVideoStream) {
    localVideoStream.getTracks().forEach(t => t.stop());
    localVideoStream = null;
  }

  // Remove video track from group call peers
  if (groupCallId) {
    for (const [peerId, pc] of Object.entries(groupCallPeers)) {
      try {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        if (videoSender) pc.removeTrack(videoSender);
      } catch (e) {}
    }
  } else if (peerConnection) {
    const senders = peerConnection.getSenders();
    const videoSender = senders.find(s => s.track?.kind === 'video');
    if (videoSender) peerConnection.removeTrack(videoSender);
  }

  // Hide screen share UI
  hideScreenShareUI();

  // Update button state
  const screenBtn = document.getElementById('gc-screen-btn');
  if (screenBtn) {
    screenBtn.classList.remove('active');
    screenBtn.querySelector('i').className = 'ri-computer-line';
  }
}

function showScreenShareUI(stream, sharerName) {
  const container = document.getElementById('gc-screen-share');
  const video = document.getElementById('gc-screen-video');
  const label = document.getElementById('gc-screen-share-label');
  const main = document.querySelector('.gc-main');
  if (!container || !video) return;

  video.srcObject = stream;
  if (label) label.textContent = `${sharerName} is sharing their screen`;
  container.classList.remove('hidden');
  if (main) main.classList.add('screen-active');
}

function hideScreenShareUI() {
  const container = document.getElementById('gc-screen-share');
  const video = document.getElementById('gc-screen-video');
  const main = document.querySelector('.gc-main');
  if (container) container.classList.add('hidden');
  if (video) { video.srcObject = null; }
  if (main) main.classList.remove('screen-active');
}

// =================== FILE SHARING ===================

export async function sendFileMessage() {
  const friend = currentChatFriend || currentChatPageFriend;
  if (!friend || !auth.currentUser) return;

  try {
    const fileData = await window.electronAPI.selectFileForChat();
    if (!fileData || !fileData.success) return;

    const chatId = getChatId(auth.currentUser.uid, friend.uid);
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      sender: auth.currentUser.uid,
      type: 'file',
      fileName: fileData.name,
      fileSize: fileData.size,
      filePath: fileData.path,
      text: `Sent a file: ${fileData.name}`,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.error('File send error:', err);
  }
}

// =================== GROUP CHATS ===================

export async function createGroup(name, memberUids) {
  if (!auth.currentUser || !name.trim()) return null;

  try {
    const groupRef = await addDoc(collection(db, 'groups'), {
      name: name.trim(),
      owner: auth.currentUser.uid,
      members: [auth.currentUser.uid, ...memberUids],
      createdAt: serverTimestamp()
    });
    return groupRef.id;
  } catch (err) {
    console.error('Create group error:', err);
    return null;
  }
}

export function loadGroupMessages(groupId) {
  if (chatPageMessagesUnsub) chatPageMessagesUnsub();

  currentChatPageChatId = `group_${groupId}`;
  const messagesRef = collection(db, 'groups', groupId, 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));
  const container = document.getElementById('chat-messages') || document.getElementById('chat-page-messages');
  if (!container) return;
  container.innerHTML = '';

  chatPageMessagesUnsub = onSnapshot(q, (snapshot) => {
    container.innerHTML = '';
    snapshot.forEach(msgDoc => {
      const msg = msgDoc.data();
      const isMine = msg.sender === auth.currentUser.uid;
      const time = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      const msgEl = document.createElement('div');
      msgEl.className = `chat-msg ${isMine ? 'sent' : 'received'}`;
      msgEl.innerHTML = `
        <div class="chat-msg-content">
          <div class="chat-msg-bubble">
            ${!isMine ? `<small style="color:#a78bfa;font-weight:500">${escapeHtml(msg.senderName || 'Unknown')}</small><br>` : ''}
            <p>${escapeHtml(msg.text || '')}</p>
          </div>
          <div class="chat-msg-meta"><span>${time}</span></div>
        </div>
      `;
      container.appendChild(msgEl);
    });
    container.scrollTop = container.scrollHeight;
  });

  listenForTyping(`group_${groupId}`);
}

export async function sendGroupMessage(groupId, text) {
  if (!auth.currentUser || !text.trim()) return;

  await addDoc(collection(db, 'groups', groupId, 'messages'), {
    sender: auth.currentUser.uid,
    senderName: currentUsername || 'Unknown',
    text: text.trim(),
    timestamp: serverTimestamp()
  });
}

// Populate DM list on chat page from friends
export function populateChatDMList(friends) {
  const container = document.getElementById('chat-dm-list');
  if (!container) return;

  if (!friends || friends.length === 0) {
    container.innerHTML = '<div class="empty-state small" style="padding:12px 16px"><p style="font-size:12px;color:#7c7295">No conversations yet</p></div>';
    return;
  }

  container.innerHTML = friends.map(f => `
    <div class="chat-channel-item" data-uid="${f.uid}" data-type="dm">
      <div class="chat-dm-avatar"><i class="ri-user-fill"></i></div>
      <div class="chat-dm-info">
        <div class="chat-dm-name">${escapeHtml(f.username)}</div>
        <div class="chat-dm-status">${f.online ? 'Online' : 'Offline'}</div>
      </div>
      <div class="online-dot ${f.online ? '' : 'offline'}"></div>
    </div>
  `).join('');

  container.querySelectorAll('.chat-channel-item').forEach(item => {
    item.addEventListener('click', () => {
      // Remove active from all
      container.querySelectorAll('.chat-channel-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const friend = friends.find(f => f.uid === item.dataset.uid);
      if (friend) openChatPage(friend);
    });
  });
}

// =================== REPLY, EDIT, DELETE, REACT ===================

export function replyToMessage(msgId, msgText) {
  replyingToMessage = { id: msgId, text: msgText?.substring(0, 50) };
  const input = document.getElementById('chat-input');
  if (input) {
    input.placeholder = `Replying to: ${replyingToMessage.text}...`;
    input.focus();
  }
  // Show reply indicator
  let indicator = document.getElementById('reply-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'reply-indicator';
    indicator.style.cssText = 'padding:6px 16px;font-size:12px;color:#a78bfa;background:rgba(124,58,237,0.1);display:flex;align-items:center;gap:8px;';
    const inputBar = document.querySelector('.msg-input-bar');
    inputBar?.parentElement?.insertBefore(indicator, inputBar);
  }
  indicator.innerHTML = `<i class="ri-reply-line"></i> Replying to: ${escapeHtml(replyingToMessage.text)} <button onclick="this.parentElement.remove();window.__cancelReply?.()" style="margin-left:auto;background:none;border:none;color:#7c6fab;cursor:pointer"><i class="ri-close-line"></i></button>`;
  window.__cancelReply = () => {
    replyingToMessage = null;
    if (input) input.placeholder = 'Type a message...';
  };
}

export async function editMessage(msgId) {
  const chatId = currentChatFriend ? getChatId(auth.currentUser.uid, currentChatFriend.uid) : null;
  if (!chatId) return;
  const msgRef = doc(db, 'chats', chatId, 'messages', msgId);
  const msgSnap = await getDoc(msgRef);
  if (!msgSnap.exists()) return;

  const newText = prompt('Edit message:', msgSnap.data().text);
  if (newText !== null && newText.trim()) {
    await updateDoc(msgRef, { text: newText.trim(), edited: true });
  }
}

export async function deleteMessage(msgId) {
  const chatId = currentChatFriend ? getChatId(auth.currentUser.uid, currentChatFriend.uid) : null;
  if (!chatId) return;
  if (!confirm('Delete this message?')) return;
  await deleteDoc(doc(db, 'chats', chatId, 'messages', msgId));
}

export function reactToMessage(msgId) {
  // Show quick emoji react picker
  const emojis = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F525}'];
  const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msgEl) return;

  let picker = msgEl.querySelector('.react-picker');
  if (picker) { picker.remove(); return; }

  picker = document.createElement('div');
  picker.className = 'react-picker';
  picker.style.cssText = 'display:flex;gap:4px;padding:4px 8px;background:rgba(20,12,45,0.95);border:1px solid rgba(139,92,246,0.2);border-radius:8px;position:absolute;bottom:-30px;right:16px;z-index:20;';
  picker.innerHTML = emojis.map(e => `<span style="cursor:pointer;font-size:18px;padding:2px 4px;border-radius:4px;transition:background 0.15s" onmouseover="this.style.background='rgba(139,92,246,0.15)'" onmouseout="this.style.background='transparent'" data-emoji="${e}">${e}</span>`).join('');

  picker.querySelectorAll('span').forEach(span => {
    span.addEventListener('click', async () => {
      // Save reaction to Firestore
      const chatId = currentChatFriend ? getChatId(auth.currentUser.uid, currentChatFriend.uid) : null;
      if (chatId) {
        const msgRef = doc(db, 'chats', chatId, 'messages', msgId);
        const { arrayUnion } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js');
        await updateDoc(msgRef, {
          [`reactions.${span.dataset.emoji}`]: arrayUnion(auth.currentUser.uid)
        });
      }
      picker.remove();
    });
  });

  msgEl.style.position = 'relative';
  msgEl.appendChild(picker);
  setTimeout(() => { document.addEventListener('click', () => picker?.remove(), { once: true }); }, 100);
}

// =================== GROUP INVITE ===================

export async function inviteToGroup(groupId, userId) {
  const { arrayUnion } = await import('https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js');
  await updateDoc(doc(db, 'groups', groupId), {
    members: arrayUnion(userId)
  });
}

// =================== GROUP VOICE CALLS (WebRTC Mesh) ===================

// All group members with their call states
let groupCallMembers = {}; // { uid: { username, state: 'in-call'|'ringing'|'declined' } }
let gcTimerInterval = null;
let gcStartTime = null;

// Start a group call — creator writes call doc + joins as first participant
export async function startGroupCall(groupId, groupName) {
  // Force-cleanup any stale call
  if (isInCall) {
    try { if (groupCallId) await endGroupCall(); else await endCall(); } catch (e) {}
    isInCall = false; currentCallId = null; groupCallId = null;
  }

  if (!auth.currentUser) return;

  const myUid = auth.currentUser.uid;
  const callId = `gc_${groupId}_${Date.now()}`;

  // Set state immediately
  isInCall = true;
  groupCallGroupId = groupId;
  groupCallId = callId;
  groupCallMembers = {};

  // Add self right away
  groupCallMembers[myUid] = { username: currentUsername || 'You', state: 'in-call' };

  // Show the full-screen UI IMMEDIATELY — don't wait for Firebase
  showGroupCallScreen(groupName || 'Group Call');

  // Get mic
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('[GROUP CALL] Microphone denied:', err);
    // Still show UI, just no mic
  }

  // Fetch group members and show them as ringing (background)
  try {
    const groupDoc = await getDoc(doc(db, 'groups', groupId));
    const allMembers = groupDoc.exists() ? (groupDoc.data().members || []) : [];
    for (const uid of allMembers) {
      if (uid !== myUid && !groupCallMembers[uid]) {
        try {
          const userDoc = await getDoc(doc(db, 'users', uid));
          groupCallMembers[uid] = { username: userDoc.exists() ? userDoc.data().username : 'Unknown', state: 'ringing' };
        } catch (e) {
          groupCallMembers[uid] = { username: 'Unknown', state: 'ringing' };
        }
      }
    }
    // Re-render with all members now visible
    renderGroupCallParticipants();
    renderGroupCallMemberList();
  } catch (e) {
    console.error('[GROUP CALL] Error loading members:', e);
  }

  // Play ringtone
  startRingtone('outgoing');
  setTimeout(stopRingtone, 5000);

  // Firebase writes (background — don't block the UI)
  try {
    await set(ref(rtdb, `/groupCalls/${callId}`), {
      groupId, groupName: groupName || 'Group Call',
      startedBy: myUid, startedByName: currentUsername || 'Unknown',
      status: 'active', timestamp: Date.now()
    });
    await set(ref(rtdb, `/groupCalls/${callId}/participants/${myUid}`), {
      username: currentUsername || 'Unknown', joinedAt: Date.now()
    });

    // Listen for participants
    listenForGroupCallParticipants();

    // Send invites to all other members
    for (const [uid, data] of Object.entries(groupCallMembers)) {
      if (uid !== myUid) {
        set(ref(rtdb, `/groupCallInvites/${uid}/${callId}`), {
          groupId, groupName: groupName || 'Group Call',
          callId, invitedBy: currentUsername || 'Unknown', timestamp: Date.now()
        }).catch(() => {});
      }
    }

    // System message
    addDoc(collection(db, 'groups', groupId, 'messages'), {
      sender: myUid, senderName: currentUsername || 'Unknown',
      text: `\u{1F4DE} ${currentUsername || 'Someone'} started a group call`,
      timestamp: serverTimestamp(), type: 'system'
    }).catch(() => {});

  } catch (err) {
    console.error('[GROUP CALL] Firebase error:', err);
    // Don't kill the UI — just log it
  }
}

// ===== Group Call Full-Screen UI =====

function showGroupCallScreen(groupName) {
  const screen = document.getElementById('group-call-screen');
  if (!screen) return;
  screen.classList.remove('hidden');

  // Set group name
  const infoEl = document.getElementById('gc-call-info');
  if (infoEl) infoEl.textContent = groupName;

  // Start timer — updates both full-screen and widget timers
  gcStartTime = Date.now();
  if (gcTimerInterval) clearInterval(gcTimerInterval);
  gcTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - gcStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    const timeStr = `${mins}:${secs}`;
    const timerEl = document.getElementById('gc-timer');
    if (timerEl) timerEl.textContent = timeStr;
    // Sync with voice panel timer
    const vpTimer = document.getElementById('voice-panel-timer');
    if (vpTimer) vpTimer.textContent = timeStr;
    // Sync with overlay
    try { window.electronAPI?.syncOverlayTimer(timeStr); } catch (e) {}
  }, 1000);

  // Render participants
  renderGroupCallParticipants();
  renderGroupCallMemberList();

  // Setup controls
  setupGroupCallControls();

  // Notify app.js + overlay
  window.dispatchEvent(new CustomEvent('call-started', { detail: { name: groupName } }));
  try { window.electronAPI?.syncOverlayCall({ active: true, groupName: groupName }); } catch (e) {}
}

function hideGroupCallScreen() {
  const screen = document.getElementById('group-call-screen');
  if (screen) screen.classList.add('hidden');
  if (gcTimerInterval) { clearInterval(gcTimerInterval); gcTimerInterval = null; }
  gcStartTime = null;
  groupCallMembers = {};
  // Stop screen share if active
  if (isScreenSharing) stopScreenShare();
  hideScreenShareUI();
  window.dispatchEvent(new CustomEvent('call-ended'));
}

// Minimize: hide full-screen but keep call alive, show voice panel
let gcMinimizedName = null;
export function minimizeGroupCall() {
  const screen = document.getElementById('group-call-screen');
  if (screen) screen.classList.add('hidden');
  gcMinimizedName = document.getElementById('gc-call-info')?.textContent || 'Group Call';
  window.dispatchEvent(new CustomEvent('gc-minimized', {
    detail: { name: gcMinimizedName, members: { ...groupCallMembers } }
  }));
}

// Broadcast member updates to the voice panel + overlay
function broadcastMemberUpdate() {
  const name = gcMinimizedName || document.getElementById('gc-call-info')?.textContent || 'Group Call';
  const myUid = auth.currentUser?.uid;
  window.dispatchEvent(new CustomEvent('gc-members-updated', {
    detail: { name, members: { ...groupCallMembers } }
  }));
  // Send to overlay
  try {
    const overlayMembers = Object.entries(groupCallMembers)
      .filter(([, d]) => d.state === 'in-call')
      .map(([uid, d]) => ({
        username: d.username, isMe: uid === myUid, muted: false
      }));
    window.electronAPI?.syncOverlayMembers(overlayMembers);
  } catch (e) {}
}

// Restore: bring back full-screen group call UI
export function restoreGroupCall() {
  if (!groupCallId) return; // No active group call
  const screen = document.getElementById('group-call-screen');
  if (!screen) return;
  screen.classList.remove('hidden');

  // Re-render everything
  renderGroupCallParticipants();
  renderGroupCallMemberList();
  setupGroupCallControls();

  // Hide the floating widget
  window.dispatchEvent(new CustomEvent('gc-restored'));
}

function renderGroupCallParticipants() {
  const container = document.getElementById('gc-participants');
  if (!container) return;

  const myUid = auth.currentUser?.uid;
  const tiles = [];

  for (const [uid, data] of Object.entries(groupCallMembers)) {
    if (data.state !== 'in-call') continue; // Only show joined members

    const isMe = uid === myUid;
    const isMuted = isMe && localStream && !localStream.getAudioTracks()[0]?.enabled;

    tiles.push(`
      <div class="gc-tile" data-uid="${uid}">
        <div class="gc-tile-avatar">
          <i class="ri-user-fill"></i>
        </div>
        <div class="gc-tile-name">
          ${isMuted ? '<i class="ri-mic-off-fill gc-mute-icon"></i>' : ''}
          ${escapeHtml(isMe ? 'You' : data.username)}
        </div>
      </div>
    `);
  }

  container.innerHTML = tiles.join('');
  // Keep voice panel in sync
  broadcastMemberUpdate();
}

function renderGroupCallMemberList() {
  const container = document.getElementById('gc-member-list');
  if (!container) return;

  const myUid = auth.currentUser?.uid;
  const inCall = [];
  const ringing = [];
  const declined = [];

  for (const [uid, data] of Object.entries(groupCallMembers)) {
    const isMe = uid === myUid;
    const entry = { uid, username: isMe ? `${data.username} (You)` : data.username, state: data.state };
    if (data.state === 'in-call') inCall.push(entry);
    else if (data.state === 'ringing') ringing.push(entry);
    else declined.push(entry);
  }

  let html = '';

  if (inCall.length > 0) {
    html += `<div class="gc-section-label">In Call - ${inCall.length}</div>`;
    html += inCall.map(m => `
      <div class="gc-member">
        <div class="gc-member-avatar"><i class="ri-user-fill"></i></div>
        <div class="gc-member-info">
          <div class="gc-member-name">${escapeHtml(m.username)}</div>
          <div class="gc-member-state in-call">Connected</div>
        </div>
      </div>
    `).join('');
  }

  if (ringing.length > 0) {
    html += `<div class="gc-section-label">Ringing - ${ringing.length}</div>`;
    html += ringing.map(m => `
      <div class="gc-member">
        <div class="gc-member-avatar" style="opacity:0.5"><i class="ri-user-fill"></i></div>
        <div class="gc-member-info">
          <div class="gc-member-name">${escapeHtml(m.username)}</div>
          <div class="gc-member-state ringing">Ringing...</div>
        </div>
      </div>
    `).join('');
  }

  if (declined.length > 0) {
    html += `<div class="gc-section-label">Declined</div>`;
    html += declined.map(m => `
      <div class="gc-member">
        <div class="gc-member-avatar" style="opacity:0.3"><i class="ri-user-fill"></i></div>
        <div class="gc-member-info">
          <div class="gc-member-name">${escapeHtml(m.username)}</div>
          <div class="gc-member-state declined">Declined</div>
        </div>
      </div>
    `).join('');
  }

  container.innerHTML = html;
}

function setupGroupCallControls() {
  // Mute
  const muteBtn = document.getElementById('gc-mute-btn');
  if (muteBtn) {
    muteBtn.onclick = () => {
      const muted = toggleMute();
      muteBtn.classList.toggle('active', muted);
      muteBtn.querySelector('i').className = muted ? 'ri-mic-off-fill' : 'ri-mic-line';
      renderGroupCallParticipants(); // Update tile mute icon
    };
  }

  // Hangup
  const hangupBtn = document.getElementById('gc-hangup-btn');
  if (hangupBtn) {
    hangupBtn.onclick = () => endGroupCall();
  }

  // Members toggle
  const membersBtn = document.getElementById('gc-members-btn');
  const sidebar = document.getElementById('gc-sidebar');
  if (membersBtn && sidebar) {
    membersBtn.onclick = () => {
      sidebar.classList.toggle('hidden');
      membersBtn.classList.toggle('active');
    };
    // Start with sidebar visible
    sidebar.classList.remove('hidden');
    membersBtn.classList.add('active');
  }

  // Sidebar close
  const sidebarClose = document.getElementById('gc-sidebar-close');
  if (sidebarClose && sidebar && membersBtn) {
    sidebarClose.onclick = () => {
      sidebar.classList.add('hidden');
      membersBtn.classList.remove('active');
    };
  }

  // Screen share
  const screenBtn = document.getElementById('gc-screen-btn');
  if (screenBtn) {
    screenBtn.onclick = async () => {
      try {
        await startScreenShare();
      } catch (e) {
        console.error('[SCREEN] Error:', e);
      }
    };
  }

  // Minimize — go back to app with floating widget
  const minimizeBtn = document.getElementById('gc-minimize-btn');
  if (minimizeBtn) {
    minimizeBtn.onclick = () => minimizeGroupCall();
  }
}

// Join an existing group call
export async function joinGroupCall(callId) {
  if (isInCall) {
    // Force-end any stale call before joining
    console.log('[GROUP CALL] Ending stale call before joining');
    if (groupCallId) await endGroupCall();
    else await endCall();
    isInCall = false;
    currentCallId = null;
  }

  console.log('[GROUP CALL] Joining call:', callId);

  // Get call data
  const callSnap = await get(ref(rtdb, `/groupCalls/${callId}`));
  const callData = callSnap.val();
  if (!callData || callData.status !== 'active') {
    alert('This call has ended.');
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('[GROUP CALL] Microphone denied:', err);
    alert('Microphone access denied.');
    return;
  }

  isInCall = true;
  groupCallId = callId;
  groupCallGroupId = callData.groupId;
  groupCallMembers = {};
  const myUid = auth.currentUser.uid;

  // Add self as participant
  await set(ref(rtdb, `/groupCalls/${callId}/participants/${myUid}`), {
    username: currentUsername || 'Unknown',
    joinedAt: Date.now()
  });

  // Remove invite
  try {
    await remove(ref(rtdb, `/groupCallInvites/${myUid}/${callId}`));
  } catch (e) {}

  // Build member list from existing participants
  const participantsSnap = await get(ref(rtdb, `/groupCalls/${callId}/participants`));
  const participants = participantsSnap.val() || {};

  for (const [uid, pData] of Object.entries(participants)) {
    groupCallMembers[uid] = {
      username: uid === myUid ? (currentUsername || 'You') : (pData.username || 'Unknown'),
      state: 'in-call'
    };
  }

  // Also fetch group members for the full member list
  try {
    const groupDoc = await getDoc(doc(db, 'groups', callData.groupId));
    if (groupDoc.exists()) {
      for (const uid of groupDoc.data().members || []) {
        if (!groupCallMembers[uid]) {
          try {
            const uDoc = await getDoc(doc(db, 'users', uid));
            groupCallMembers[uid] = { username: uDoc.exists() ? uDoc.data().username : 'Unknown', state: 'ringing' };
          } catch (e) {
            groupCallMembers[uid] = { username: 'Unknown', state: 'ringing' };
          }
        }
      }
    }
  } catch (e) {}

  // Show the full-screen group call UI
  showGroupCallScreen(callData.groupName || 'Group Call');

  // Create peer connections to all existing participants
  for (const [peerId, peerData] of Object.entries(participants)) {
    if (peerId !== myUid) {
      await createGroupPeerConnection(callId, myUid, peerId, true);
    }
  }

  // Listen for new participants
  listenForGroupCallParticipants();
}

// Create a peer connection to another participant in the group call
async function createGroupPeerConnection(callId, myUid, peerId, isInitiator) {
  if (groupCallPeers[peerId]) return; // Already connected

  console.log(`[GROUP CALL] Creating peer connection: ${myUid} <-> ${peerId}, initiator: ${isInitiator}`);

  const pc = new RTCPeerConnection(ICE_SERVERS);
  groupCallPeers[peerId] = pc;

  // Add local audio tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Add screen share video track if currently sharing
  if (isScreenSharing && localVideoStream) {
    localVideoStream.getVideoTracks().forEach(track => pc.addTrack(track, localVideoStream));
  }

  // Handle remote tracks (audio + video/screen share)
  pc.ontrack = (event) => {
    const track = event.track;
    console.log(`[GROUP CALL] Got remote ${track.kind} track from ${peerId}`);

    if (track.kind === 'audio') {
      let audioEl = document.getElementById(`group-audio-${peerId}`);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `group-audio-${peerId}`;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = event.streams[0];
    } else if (track.kind === 'video') {
      // Remote peer is screen sharing — show it
      const peerName = groupCallMembers[peerId]?.username || 'Someone';
      showScreenShareUI(event.streams[0], peerName);

      // When the remote track ends, hide the screen share
      track.onended = () => hideScreenShareUI();
      track.onmute = () => hideScreenShareUI();
    }
  };

  // ICE candidates — store under signaling path
  const signalingPath = `/groupCalls/${callId}/signaling/${myUid}_${peerId}`;
  const reverseSignalingPath = `/groupCalls/${callId}/signaling/${peerId}_${myUid}`;

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      push(ref(rtdb, `${signalingPath}/candidates`))
        .then(r => set(r, event.candidate.toJSON()))
        .catch(e => console.error('[GROUP CALL] ICE error:', e));
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[GROUP CALL] ICE state with ${peerId}:`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      removeGroupPeer(peerId);
    }
  };

  if (isInitiator) {
    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await set(ref(rtdb, `${signalingPath}/offer`), { type: offer.type, sdp: offer.sdp });

    // Listen for answer
    onValue(ref(rtdb, `${reverseSignalingPath}/answer`), async (snapshot) => {
      const answer = snapshot.val();
      if (answer && pc.signalingState === 'have-local-offer') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (e) {
          console.error('[GROUP CALL] Error setting remote desc:', e);
        }
      }
    });

    // Listen for remote ICE candidates
    onChildAdded(ref(rtdb, `${reverseSignalingPath}/candidates`), (snapshot) => {
      if (pc.signalingState !== 'closed') {
        pc.addIceCandidate(new RTCIceCandidate(snapshot.val())).catch(e =>
          console.error('[GROUP CALL] ICE candidate error:', e)
        );
      }
    });
  } else {
    // Wait for offer from the other peer
    onValue(ref(rtdb, `${reverseSignalingPath}/offer`), async (snapshot) => {
      const offer = snapshot.val();
      if (!offer || pc.signalingState !== 'stable') return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await set(ref(rtdb, `${signalingPath}/answer`), { type: answer.type, sdp: answer.sdp });
      } catch (e) {
        console.error('[GROUP CALL] Error handling offer:', e);
      }
    });

    // Listen for remote ICE candidates
    onChildAdded(ref(rtdb, `${reverseSignalingPath}/candidates`), (snapshot) => {
      if (pc.signalingState !== 'closed') {
        pc.addIceCandidate(new RTCIceCandidate(snapshot.val())).catch(e =>
          console.error('[GROUP CALL] ICE candidate error:', e)
        );
      }
    });
  }
}

// Listen for participants joining/leaving
function listenForGroupCallParticipants() {
  if (!groupCallId) return;
  const myUid = auth.currentUser.uid;

  // Clean up old listener
  if (groupCallParticipantsUnsub) {
    off(ref(rtdb, `/groupCalls/${groupCallId}/participants`));
  }

  groupCallParticipantsUnsub = onValue(ref(rtdb, `/groupCalls/${groupCallId}/participants`), async (snapshot) => {
    const participants = snapshot.val() || {};
    const participantIds = Object.keys(participants);

    // Update member states: joined members are 'in-call'
    for (const peerId of participantIds) {
      if (groupCallMembers[peerId]) {
        groupCallMembers[peerId].state = 'in-call';
        // Update username if we have it from participant data
        if (participants[peerId]?.username) {
          groupCallMembers[peerId].username = participants[peerId].username;
        }
      } else {
        groupCallMembers[peerId] = {
          username: participants[peerId]?.username || 'Unknown',
          state: 'in-call'
        };
      }
    }

    // Members who left after joining => mark as declined
    for (const [uid, data] of Object.entries(groupCallMembers)) {
      if (data.state === 'in-call' && uid !== myUid && !participantIds.includes(uid)) {
        data.state = 'declined';
        removeGroupPeer(uid);
      }
    }

    // Re-render the UI
    renderGroupCallParticipants();
    renderGroupCallMemberList();

    // Connect to new participants via WebRTC
    for (const peerId of participantIds) {
      if (peerId !== myUid && !groupCallPeers[peerId]) {
        await createGroupPeerConnection(groupCallId, myUid, peerId, false);
      }
    }

    // Remove WebRTC peers who left
    for (const peerId of Object.keys(groupCallPeers)) {
      if (!participantIds.includes(peerId)) {
        removeGroupPeer(peerId);
      }
    }
  });

  // Listen for declined invites — mark members who dismissed
  for (const [uid, data] of Object.entries(groupCallMembers)) {
    if (uid !== myUid && data.state === 'ringing') {
      onValue(ref(rtdb, `/groupCallInvites/${uid}/${groupCallId}`), (snap) => {
        if (!snap.exists() && groupCallMembers[uid]?.state === 'ringing') {
          // Invite was removed (dismissed/declined) and they never joined
          const participants = document.getElementById('gc-participants');
          if (participants) {
            groupCallMembers[uid].state = 'declined';
            renderGroupCallParticipants();
            renderGroupCallMemberList();
          }
        }
      });
    }
  }

  // Also listen for call status changes
  if (groupCallListenerUnsub) {
    off(ref(rtdb, `/groupCalls/${groupCallId}/status`));
  }
  groupCallListenerUnsub = onValue(ref(rtdb, `/groupCalls/${groupCallId}/status`), (snapshot) => {
    if (snapshot.val() === 'ended' && groupCallId) {
      endGroupCall();
    }
  });

  // Auto-mark ringing members as declined after 30s
  setTimeout(() => {
    for (const [uid, data] of Object.entries(groupCallMembers)) {
      if (data.state === 'ringing') {
        data.state = 'declined';
      }
    }
    renderGroupCallParticipants();
    renderGroupCallMemberList();
  }, 30000);
}

// Remove a peer connection
function removeGroupPeer(peerId) {
  const pc = groupCallPeers[peerId];
  if (pc) {
    pc.close();
    delete groupCallPeers[peerId];
  }
  const audioEl = document.getElementById(`group-audio-${peerId}`);
  if (audioEl) audioEl.remove();
}

// End group call (leave or end entirely)
export async function endGroupCall() {
  console.log('[GROUP CALL] Ending group call');
  const myUid = auth.currentUser?.uid;
  const callId = groupCallId;

  // Close all peer connections
  for (const peerId of Object.keys(groupCallPeers)) {
    removeGroupPeer(peerId);
  }
  groupCallPeers = {};

  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  // Remove self from participants
  if (callId && myUid) {
    try {
      await remove(ref(rtdb, `/groupCalls/${callId}/participants/${myUid}`));
    } catch (e) {}

    // Check if anyone else is still in the call
    try {
      const pSnap = await get(ref(rtdb, `/groupCalls/${callId}/participants`));
      const remaining = pSnap.val();
      if (!remaining || Object.keys(remaining).length === 0) {
        // Last person left — mark call as ended
        await set(ref(rtdb, `/groupCalls/${callId}/status`), 'ended');
        // Clean up after delay
        setTimeout(async () => {
          try { await remove(ref(rtdb, `/groupCalls/${callId}`)); } catch (e) {}
        }, 5000);
      }
    } catch (e) {}

    // Clean up signaling data for this user
    try {
      const sigSnap = await get(ref(rtdb, `/groupCalls/${callId}/signaling`));
      const sigData = sigSnap.val();
      if (sigData) {
        for (const key of Object.keys(sigData)) {
          if (key.startsWith(`${myUid}_`) || key.endsWith(`_${myUid}`)) {
            await remove(ref(rtdb, `/groupCalls/${callId}/signaling/${key}`));
          }
        }
      }
    } catch (e) {}
  }

  // Clean up listeners
  if (groupCallParticipantsUnsub) {
    off(ref(rtdb, `/groupCalls/${callId}/participants`));
    groupCallParticipantsUnsub = null;
  }
  if (groupCallListenerUnsub) {
    off(ref(rtdb, `/groupCalls/${callId}/status`));
    groupCallListenerUnsub = null;
  }

  groupCallId = null;
  groupCallGroupId = null;
  isInCall = false;

  hideGroupCallScreen();
  hideCallUI();
}

// Update the call widget for group calls (legacy — kept for compatibility)
function updateGroupCallWidget(groupName, participantCount) {
  const nameEl = document.getElementById('call-widget-name');
  if (nameEl) nameEl.textContent = groupName;

  // Add/update participant count
  let countEl = document.getElementById('call-widget-participants');
  if (!countEl) {
    const infoEl = document.querySelector('.call-widget-info');
    if (infoEl) {
      countEl = document.createElement('span');
      countEl.id = 'call-widget-participants';
      countEl.className = 'call-widget-participants';
      infoEl.appendChild(countEl);
    }
  }
  if (countEl) countEl.textContent = `${participantCount} in call`;
}

// Check if we're currently in a group call
export function isGroupCall() {
  return !!groupCallId;
}

// Listen for incoming group call invites
export function listenForGroupCallInvites() {
  const myUid = auth.currentUser?.uid;
  if (!myUid) return;

  onValue(ref(rtdb, `/groupCallInvites/${myUid}`), (snapshot) => {
    const invites = snapshot.val();
    if (!invites) return;

    Object.entries(invites).forEach(([callId, inviteData]) => {
      // Don't show invite if already in a call or if invite is old (>60s)
      if (isInCall) return;
      if (Date.now() - inviteData.timestamp > 60000) {
        remove(ref(rtdb, `/groupCallInvites/${myUid}/${callId}`));
        return;
      }

      // Show incoming group call notification
      showGroupCallInvite(callId, inviteData);
    });
  });
}

// Show group call invite notification
function showGroupCallInvite(callId, inviteData) {
  // Check if we already have a notification for this call
  if (document.getElementById(`gc-invite-${callId}`)) return;

  const notification = document.createElement('div');
  notification.id = `gc-invite-${callId}`;
  notification.className = 'group-call-invite';
  notification.innerHTML = `
    <div class="gc-invite-info">
      <i class="ri-phone-fill gc-invite-icon"></i>
      <div>
        <strong>${escapeHtml(inviteData.invitedBy)}</strong> started a call in
        <strong>${escapeHtml(inviteData.groupName)}</strong>
      </div>
    </div>
    <div class="gc-invite-actions">
      <button class="gc-invite-join" data-call-id="${callId}">
        <i class="ri-phone-fill"></i> Join
      </button>
      <button class="gc-invite-dismiss" data-call-id="${callId}">
        <i class="ri-close-line"></i>
      </button>
    </div>
  `;

  document.body.appendChild(notification);

  // Animate in
  requestAnimationFrame(() => notification.classList.add('show'));

  // Join button
  notification.querySelector('.gc-invite-join').addEventListener('click', () => {
    notification.remove();
    joinGroupCall(callId);
  });

  // Dismiss button
  notification.querySelector('.gc-invite-dismiss').addEventListener('click', () => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
    remove(ref(rtdb, `/groupCallInvites/${auth.currentUser.uid}/${callId}`));
  });

  // Auto-dismiss after 30 seconds
  setTimeout(() => {
    if (document.getElementById(`gc-invite-${callId}`)) {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
      remove(ref(rtdb, `/groupCallInvites/${auth.currentUser.uid}/${callId}`));
    }
  }, 30000);

  // Play notification sound
  startRingtone('incoming');
  setTimeout(stopRingtone, 3000);

  // OS notification
  try {
    window.electronAPI.showNotification(
      'Group Call',
      `${inviteData.invitedBy} started a call in ${inviteData.groupName}`
    );
  } catch (e) {}
}

// Cleanup
export function cleanupChat() {
  if (messagesUnsubscribe) messagesUnsubscribe();
  if (chatPageMessagesUnsub) chatPageMessagesUnsub();
  if (typingListenerUnsub) typingListenerUnsub();
  stopRingtone();
  if (groupCallId) endGroupCall();
  else endCall();
  incomingCallsActive = false;
  isScreenSharing = false;
}
