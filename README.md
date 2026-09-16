# fiddlesticks

https://fiddlesticks.zingweb.com

A shared HTML/CSS scratchpad. Open `/`, get a room URL, send it to someone, and edit together with a live preview. Everyone's cursor shows up with their name on it.

## How it works

- **Hosting:** Cloudflare Workers. The React app is served as static assets; any unknown path (a room id) falls back to `index.html`.
- **Rooms:** one Durable Object per room (`worker/index.js`), reached at `/parties/room/<roomId>` over a websocket.
- **Preview:** a sandboxed iframe (`allow-scripts`) rebuilt from the HTML and CSS after each pause in typing. Each update mounts a fresh iframe, because Chrome runs sandboxed frames in their own process and those often stay blank when their `srcdoc` changes.
- **Editing:** the HTML and CSS are two `Y.Text`s in a Yjs doc, bound to CodeMirror with `y-codemirror.next`. Concurrent edits merge instead of overwriting each other.
- **Presence:** Yjs awareness carries each person's name, color and cursor. Set your name in the top bar; it's remembered in `localStorage`. The room keeps each socket's last presence message in its attachment so presence survives hibernation.
- **Storage:** the room hibernates when idle and saves its doc to Durable Object storage (2s debounce, 10s max). Docs over ~2 MB can't be saved and everyone in the room sees a warning. Rooms nobody opens for 30 days are deleted.
- **Keep-alive:** clients ping every 20s and the Durable Object auto-responds without waking, so dead sockets (laptop sleep, Wi-Fi changes) get noticed and reconnected.

## Develop

```sh
npm install
npm run dev      # Vite + the Worker and Durable Object running locally in workerd
```

## Deploy

```sh
npx wrangler login   # once
npm run deploy       # vite build && wrangler deploy
```
