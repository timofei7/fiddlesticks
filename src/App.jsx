import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import { EditorView, placeholder } from '@codemirror/view';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { oneDark } from '@codemirror/theme-one-dark';
import { awareness, COLORS, cssText, htmlText, MAX_NAME, provider, ydoc } from './collab';
import { editorSetup } from './editorSetup';
import './App.css';

const ANIMALS = ['Otter', 'Heron', 'Lynx', 'Moose', 'Newt', 'Owl', 'Fox', 'Wren', 'Badger', 'Marten'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const USER_KEY = 'fiddlesticks:user';

function loadUser() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(USER_KEY)) || {};
  } catch {}
  return {
    name: saved.name || `Anonymous ${pick(ANIMALS)}`,
    color: COLORS.includes(saved.color) ? saved.color : pick(COLORS),
  };
}

let renames = 0;
function publishUser({ name, color }) {
  // y-codemirror only redraws a remote caret when its color string changes,
  // so flip the hex case on each rename to refresh the label on everyone's screen.
  const shown = renames++ % 2 ? color.toUpperCase() : color;
  awareness.setLocalStateField('user', { name: name.trim() || 'Anonymous', color: shown, colorLight: `${shown}33` });
  try {
    localStorage.setItem(USER_KEY, JSON.stringify({ name, color }));
  } catch {}
}

// Everyone in the room, re-rendered only when someone joins, leaves or renames
// (not on every remote cursor move).
function usePeers() {
  const [peers, setPeers] = useState([]);
  useEffect(() => {
    let lastKey = '';
    const update = () => {
      const next = [...awareness.getStates()]
        .filter(([id, state]) => state.user && id !== ydoc.clientID)
        .map(([id, state]) => ({ id, name: state.user.name, color: state.user.color }));
      const key = next.map((p) => `${p.id}:${p.name}:${p.color}`).join('|');
      if (key !== lastKey) {
        lastKey = key;
        setPeers(next);
      }
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, []);
  return peers;
}

// Report "offline" only after 3s without a connection, so a quick reconnect doesn't flash a warning.
function useConnection() {
  const [online, setOnline] = useState(true);
  const [tooLarge, setTooLarge] = useState(false);
  useEffect(() => {
    let timer;
    const goOfflineSoon = () => {
      timer ??= setTimeout(() => setOnline(false), 3000);
    };
    const onStatus = ({ status }) => {
      if (status !== 'connected') return goOfflineSoon();
      clearTimeout(timer);
      timer = undefined;
      setOnline(true);
    };
    const onMessage = (message) => {
      if (message === 'too-large') setTooLarge(true);
      if (message === 'saved') setTooLarge(false);
    };
    if (!provider.wsconnected) goOfflineSoon();
    provider.on('status', onStatus);
    provider.on('custom-message', onMessage);
    return () => {
      clearTimeout(timer);
      provider.off('status', onStatus);
      provider.off('custom-message', onMessage);
    };
  }, []);
  return { online, tooLarge };
}

function Editor({ ytext, language, hint }) {
  const host = useRef(null);
  useEffect(() => {
    const undoManager = new Y.UndoManager(ytext);
    const view = new EditorView({
      parent: host.current,
      // yCollab only forwards changes made after this point, so start from what's already synced.
      doc: ytext.toString(),
      extensions: [editorSetup, language(), oneDark, placeholder(hint), yCollab(ytext, awareness, { undoManager })],
    });
    return () => {
      view.destroy();
      undoManager.destroy();
    };
  }, [ytext, language, hint]);
  return <div className="cm-host" ref={host} />;
}

const previewDoc = () => `<style>${cssText}</style>\n${htmlText}`;

// Rebuilding the iframe is the expensive part: wait for a 150ms pause in typing,
// but refresh at least every 500ms while people keep going.
function Preview() {
  const [preview, setPreview] = useState(() => ({ doc: previewDoc(), version: 0 }));
  useEffect(() => {
    let timer;
    let waitingSince = 0;
    const render = () => {
      waitingSince = 0;
      setPreview((prev) => {
        const doc = previewDoc();
        return doc === prev.doc ? prev : { doc, version: prev.version + 1 };
      });
    };
    const schedule = () => {
      clearTimeout(timer);
      waitingSince ||= Date.now();
      timer = setTimeout(render, Date.now() - waitingSince > 500 ? 0 : 150);
    };
    htmlText.observe(schedule);
    cssText.observe(schedule);
    render();
    return () => {
      clearTimeout(timer);
      htmlText.unobserve(schedule);
      cssText.unobserve(schedule);
    };
  }, []);
  // Chrome runs this sandboxed frame in its own process, and such a frame often stays
  // blank after its srcdoc changes. A fresh iframe per update (the key) always paints.
  return <iframe key={preview.version} srcDoc={preview.doc} title="preview" sandbox="allow-scripts" />;
}

function Header() {
  const [user, setUser] = useState(loadUser);
  const [copyLabel, setCopyLabel] = useState('Copy link');
  const peers = usePeers();
  const { online, tooLarge } = useConnection();

  useEffect(() => publishUser(user), [user]);

  const rename = (event) => {
    const name = event.target.value.slice(0, MAX_NAME);
    setUser((prev) => ({ ...prev, name }));
  };

  const keepName = () => {
    setUser((prev) => (prev.name.trim() ? prev : { ...prev, name: `Anonymous ${pick(ANIMALS)}` }));
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyLabel('Copied!');
    } catch {
      setCopyLabel('Copy failed');
    }
    setTimeout(() => setCopyLabel('Copy link'), 1500);
  };

  return (
    <header className="topbar">
      <span className={`status ${online ? 'online' : 'offline'}`} title={online ? 'Connected' : 'Offline'} />
      <strong>fiddlesticks</strong>
      <button onClick={copyLink}>{copyLabel}</button>
      <a href="/new">New room</a>
      {!online && <span className="warning">Offline. Your edits will sync when the connection comes back.</span>}
      {tooLarge && <span className="warning">This room is over 2 MB and isn't being saved. Remove something big, like a pasted image.</span>}
      <label className="handle">
        <span className="swatch" style={{ background: user.color }} />
        <input value={user.name} onChange={rename} onBlur={keepName} maxLength={MAX_NAME} aria-label="Your name" />
      </label>
      <ul className="peers">
        {peers.map((p) => (
          <li key={p.id} style={{ borderColor: p.color }} title={p.name}>
            {p.name}
          </li>
        ))}
      </ul>
    </header>
  );
}

export default function App() {
  return (
    <div className="app">
      <Header />
      <div className="editor">
        <div className="code-panels">
          <div className="panel">
            <h2>HTML</h2>
            <Editor ytext={htmlText} language={html} hint="Enter HTML here..." />
          </div>
          <div className="panel">
            <h2>CSS</h2>
            <Editor ytext={cssText} language={css} hint="Enter CSS here..." />
          </div>
        </div>
        <div className="preview-panel">
          <h2>Preview</h2>
          <Preview />
        </div>
      </div>
    </div>
  );
}
