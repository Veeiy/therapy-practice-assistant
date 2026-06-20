// Ambient type for the preload bridge. This is what makes window.api fully typed in
// the renderer without the renderer importing any main-process code: it sees only
// the RendererApi surface the preload exposes.

import type { RendererApi } from '../shared/types/ipc.js';

declare global {
  interface Window {
    api: RendererApi;
  }
}

export {};
