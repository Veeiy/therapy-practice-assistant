// notes module: the ONE functional workflow this wave (workflow 1 of 4).
//
// A module is a directory plus one line in src/modules/index.ts. It exposes a
// WorkflowModule: an id/title for the nav rail, a `functional` flag, and a
// registerIpc() that wires its main-process handlers onto the shared IpcRouter.
// The spine never imports this file's internals; it only iterates the registry.
//
// The handlers here are thin: they translate an IPC request into a NoteService
// call. The service holds all the lifecycle + F2/F4/F5 logic; this file is just
// the plug.

import type { WorkflowModule } from '@shared/types/module.js';
import type { IpcRouter } from '@shared/types/ipc.js';
import type {
  CreateDraftNoteReq,
  RequestDraftReq,
  SaveSectionsReq,
  SignNoteReq,
  AddAddendumReq,
} from '@shared/types/ipc.js';
import { CHANNELS } from '@shared/constants.js';
import type { NoteService } from './noteService.js';
import type { DraftNoteInput } from '@shared/types/agent.js';

export interface NotesModuleDeps {
  service: NoteService;
}

export function createNotesModule(deps: NotesModuleDeps): WorkflowModule {
  return {
    id: 'notes',
    title: 'Session Notes',
    icon: 'notes',
    functional: true,

    registerIpc(router: IpcRouter): void {
      router.handle(CHANNELS.notesList, (req: { client_id?: string; status?: string } = {}) =>
        deps.service.list(req)
      );

      router.handle(CHANNELS.notesGet, (req: { id: string }) => deps.service.get(req.id));

      router.handle(CHANNELS.notesCreateDraft, (req: CreateDraftNoteReq) =>
        deps.service.createDraft({
          client_id: req.client_id,
          appointment_id: req.appointment_id ?? null,
          format: req.format,
        })
      );

      router.handle(CHANNELS.notesRequestDraft, (req: RequestDraftReq) =>
        deps.service.requestDraft({
          note_id: req.note_id,
          shorthand: req.shorthand,
          cues: req.cues as DraftNoteInput['cues'],
        })
      );

      router.handle(CHANNELS.notesSaveSections, (req: SaveSectionsReq) =>
        deps.service.saveSections(req.note_id, req.sections)
      );

      router.handle(CHANNELS.notesSign, (req: SignNoteReq) =>
        deps.service.sign(req.note_id, req.signed_by)
      );

      router.handle(CHANNELS.notesAddAddendum, (req: AddAddendumReq) =>
        deps.service.addAddendum(req.note_id, req.author, req.body)
      );
    },
  };
}
