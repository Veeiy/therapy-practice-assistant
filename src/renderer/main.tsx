// renderer entry: mounts the React shell. The renderer is a sandboxed React app
// that talks ONLY to window.api (the preload bridge). It never imports Node, the
// DB, or the SDK.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
