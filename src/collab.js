// Shared state for the page: the room, the Yjs doc, and the connection.
// Kept out of App.jsx so a hot reload of the UI doesn't open a second connection.
import { customAlphabet } from 'nanoid';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';

// The room is the URL path. "/" and "/new" get a fresh id, lowercase so it reads well off a projector.
const newRoomId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

function getRoomId() {
  const id = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (/^[\w-]{1,64}$/.test(id) && id !== 'new') return id;
  const fresh = newRoomId();
  window.history.replaceState(null, '', `/${fresh}`);
  return fresh;
}

export const roomId = getRoomId();

// One shared doc per room; each editor binds to its own Y.Text.
// Yjs merges concurrent edits character by character, so two people
// typing at once no longer overwrite each other's whole document.
export const ydoc = new Y.Doc();
export const htmlText = ydoc.getText('html');
export const cssText = ydoc.getText('css');
export const provider = new YProvider(window.location.host, roomId, ydoc, {
  party: 'room',
  protocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
});
export const { awareness } = provider;

// The stock provider re-sends every presence change it hears, including other
// people's, so one cursor move costs N² messages in a room of N. Only announce our own.
const sendPresence = provider._awarenessUpdateHandler;
awareness.off('change', sendPresence);
awareness.on('change', ({ added, updated, removed }, origin) => {
  if ([...added, ...updated, ...removed].includes(ydoc.clientID)) {
    sendPresence({ added: [], updated: [ydoc.clientID], removed: [] }, origin);
  }
});

export const COLORS = [
  '#e06c75', '#e5c07b', '#98c379', '#56b6c2', '#61afef', '#c678dd',
  '#d19a66', '#ff79c6', '#f1fa8c', '#8be9fd', '#ffb86c', '#a3be8c',
];
export const MAX_NAME = 24;

// y-codemirror writes a peer's color straight into a style attribute, so a
// hand-crafted color could restyle everyone's page. Clean remote states before
// the editors read them (this listener is registered first, so it runs first).
const HEX = /^#[0-9a-f]{6}$/i;
awareness.on('change', ({ added, updated }) => {
  for (const id of [...added, ...updated]) {
    const state = awareness.getStates().get(id);
    if (!state || id === ydoc.clientID) continue;
    if (typeof state.user !== 'object' || state.user === null) state.user = {};
    const { user } = state;
    if (!HEX.test(user.color)) user.color = '#888888';
    user.colorLight = `${user.color}33`;
    user.name = String(user.name ?? '').slice(0, MAX_NAME) || 'Anonymous';
  }
});

// The provider can't tell a silently dead socket (laptop sleep, Wi-Fi switch)
// from a quiet room. Ping every 20s; the Worker answers without waking the room.
// A ping still unanswered at the next tick means the socket is dead, so reconnect.
let awaitingPong = false;
provider.on('custom-message', (message) => {
  if (message === 'pong') awaitingPong = false;
});
provider.on('status', () => {
  awaitingPong = false;
});
setInterval(() => {
  if (!provider.wsconnected) return;
  if (awaitingPong) {
    provider.ws?.close();
  } else {
    awaitingPong = true;
    provider.sendMessage('ping');
  }
}, 20_000);
