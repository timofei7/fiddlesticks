
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const socket = io();

export default function App() {
  const [html, setHtml] = useState('');
  const [css, setCSS] = useState('');
  const [roomId, setRoomId] = useState('');

  useEffect(() => {
    const pathRoomId = window.location.pathname.substring(1);
    setRoomId(pathRoomId);
    
    socket.emit('join', pathRoomId);
    
    socket.on('initial', (data) => {
      setHtml(data.html);
      setCSS(data.css);
    });

    socket.on('codeUpdate', ({ type, code }) => {
      if (type === 'html') setHtml(code);
      if (type === 'css') setCSS(code);
    });

    return () => socket.off('codeUpdate');
  }, []);

  const handleChange = (type, value) => {
    if (type === 'html') setHtml(value);
    if (type === 'css') setCSS(value);
    socket.emit('codeChange', { roomId, type, code: value });
  };

  const preview = `
    <style>${css}</style>
    ${html}
  `;

  return (
    <div className="editor">
      <div className="code-panels">
        <div className="panel">
          <h2>HTML</h2>
          <textarea
            value={html}
            onChange={(e) => handleChange('html', e.target.value)}
            placeholder="Enter HTML here..."
          />
        </div>
        <div className="panel">
          <h2>CSS</h2>
          <textarea
            value={css}
            onChange={(e) => handleChange('css', e.target.value)}
            placeholder="Enter CSS here..."
          />
        </div>
      </div>
      <div className="preview-panel">
        <h2>Preview</h2>
        <iframe
          srcDoc={preview}
          title="preview"
          sandbox="allow-scripts"
        />
      </div>
    </div>
  );
}
