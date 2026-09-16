import { routePartykitRequest } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';

const DAY_MS = 24 * 60 * 60 * 1000;
// Rooms nobody opens for this long are deleted.
const ROOM_TTL_MS = 30 * DAY_MS;
// Durable Object storage caps a single value at 2 MB.
const MAX_DOC_BYTES = 1.9 * 1024 * 1024;
const ROOM_PATH = /^\/parties\/room\/[\w-]{1,64}$/;
const MESSAGE_AWARENESS = 1;

// One Durable Object per room. It holds the shared Yjs doc (html + css text)
// and relays edits and presence (cursors, handles) between everyone in it.
export class Room extends YServer {
  // Sleep between messages instead of billing for idle websockets.
  // Hibernation drops memory, so the doc is reloaded from storage on wake.
  static options = { hibernate: true };

  constructor(ctx, env) {
    super(ctx, env);
    // Clients ping every 20s to catch dead sockets; answer without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('__YPS:ping', '__YPS:pong'));
  }

  onCustomMessage(conn, message) {
    if (message === 'ping') this.sendCustomMessage(conn, 'pong');
  }

  async onLoad() {
    const saved = this.ctx.storage.kv.get('doc');
    if (saved) Y.applyUpdate(this.document, saved);
  }

  async onStart() {
    await super.onStart();
    // Hibernation also wipes the presence list, and clients don't re-announce.
    // Rebuild it from what each socket last sent, so people who join after a
    // nap see everyone and people who leave get cleared from everyone's screen.
    for (const conn of this.getConnections()) this.restorePresence(conn);
    await this.extendExpiry();
  }

  onMessage(conn, message) {
    if (typeof message !== 'string') {
      try {
        const decoder = decoding.createDecoder(new Uint8Array(message));
        if (decoding.readVarUint(decoder) === MESSAGE_AWARENESS) {
          const presence = decoding.readVarUint8Array(decoder).slice();
          conn.setState((state) => ({ ...state, presence }));
        }
      } catch {}
    }
    return super.onMessage(conn, message);
  }

  onClose(conn, code, reason, wasClean) {
    // A closed socket isn't in getConnections(), so onStart can't have restored it.
    this.restorePresence(conn);
    return super.onClose(conn, code, reason, wasClean);
  }

  restorePresence(conn) {
    try {
      const presence = conn.state?.presence;
      if (presence) awarenessProtocol.applyAwarenessUpdate(this.document.awareness, presence, conn);
    } catch {}
  }

  async onSave() {
    const update = Y.encodeStateAsUpdate(this.document);
    if (update.byteLength > MAX_DOC_BYTES) {
      this.saveOk = false;
      this.broadcastCustomMessage('too-large');
      return;
    }
    this.ctx.storage.kv.put('doc', update);
    // First good save since waking (or since a failed one) clears any warning clients show.
    if (this.saveOk !== true) {
      this.saveOk = true;
      this.broadcastCustomMessage('saved');
    }
    await this.extendExpiry();
  }

  // Each setAlarm is a billed storage write, so move the deadline at most once a day.
  async extendExpiry() {
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm || alarm < Date.now() + ROOM_TTL_MS - DAY_MS) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    }
  }

  async onAlarm() {
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request, env) {
    // Only websocket upgrades for well-formed room names get to wake a Room.
    const { pathname } = new URL(request.url);
    const isSocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    if (!isSocket || !ROOM_PATH.test(pathname)) return new Response('Not found', { status: 404 });
    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
};
