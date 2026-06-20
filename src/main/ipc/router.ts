// ipc/router: the one place ipcMain.handle is called, wrapped so that:
//   * every handler runs inside a try/catch that converts a thrown Error into a
//     SERIALIZABLE { __ipcError: true, code, message } the renderer can branch on
//     (so a friendly screen can show "this note is signed" without parsing prose),
//   * errors are logged with F4 hygiene (code + scrubbed message, never PHI),
//   * the renderer only ever sees the whitelisted channels a module registered.
//
// The IpcRouter interface (in @shared/types/ipc) is what modules program against;
// this class is its main-process implementation over Electron's ipcMain.

import type { IpcRouter } from '@shared/types/ipc.js';
import type { Logger } from '@main/agent/logger.js';

/** Shape the preload recognizes and rethrows as a real Error on the renderer side. */
export interface SerializedIpcError {
  __ipcError: true;
  code?: string;
  message: string;
}

function toSerializedError(e: unknown): SerializedIpcError {
  if (e instanceof Error) {
    return {
      __ipcError: true,
      code: (e as NodeJS.ErrnoException).code,
      message: e.message,
    };
  }
  return { __ipcError: true, message: 'Unexpected error.' };
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export class MainIpcRouter implements IpcRouter {
  constructor(
    private readonly ipcMain: IpcMainLike,
    private readonly log: Logger
  ) {}

  handle<TReq, TRes>(channel: string, fn: (req: TReq) => Promise<TRes> | TRes): void {
    this.ipcMain.handle(channel, async (_event, req) => {
      try {
        return await fn(req as TReq);
      } catch (e) {
        const err = toSerializedError(e);
        // F4: log code + scrubbed message only; never the request payload (PHI).
        this.log.error('ipc_handler_error', err.message, { channel, code: err.code ?? null });
        return err;
      }
    });
  }
}
