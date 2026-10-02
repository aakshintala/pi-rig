// Pi's main editor, found by structure: Pi exposes no handle to it.
import { VERSION } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";

/**
 * Whether Ctrl+B is free of Pi's default cursor-left binding, so it can background
 * commands (#29). Read it on each use: /reload re-reads keybindings.json after session_start.
 */
export const ctrlBFree = () => !getKeybindings().getKeys("tui.editor.cursorLeft").includes("ctrl+b");

type Node = { children?: unknown[]; getFocusedComponent?: () => unknown };

const EDITOR_KEYS = ["onSubmit", "getText", "handleInput"];

/** Duck-typed editor check: Pi wires its submit handler onto every editor it mounts in the slot. */
const isEditor = (node: unknown) =>
  EDITOR_KEYS.every((k) => typeof (node as Record<string, unknown> | undefined)?.[k] === "function");

/**
 * Pi's main editor: the sole child of whichever root child holds it. Pi mounts the
 * editor container as one of the root's children and wires its submit handler onto
 * every editor it mounts there; pickers and the reload box that take the slot have
 * none. The lookup is redone on each call so an editor swapped in by setEditorComponent is found.
 */
export function findEditor(tui: unknown): Record<string, unknown> | undefined {
  const kids = (tui as Node | undefined)?.children;
  if (!Array.isArray(kids)) return undefined;
  for (const slot of kids) {
    const slotKids = (slot as Node | undefined)?.children;
    if (!Array.isArray(slotKids) || slotKids.length !== 1) continue;
    const candidate = slotKids[0];
    if (isEditor(candidate)) return candidate as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Whether Pi's main editor has focus, so no picker, dialog or overlay owns the key.
 *
 * The editor slot is found by walking the root's children for the container whose
 * sole child duck-types as editor; pickers and the reload box that take the slot
 * have no submit handler. With anything else in the slot or in focus, it returns
 * false: the caller treats that as "cannot tell", never as a wrong component.
 */
export function editorFocused(tui: unknown, _version: string = VERSION): boolean {
  const root = tui as Node | undefined;
  const editor = findEditor(root);
  return !!editor && root!.getFocusedComponent?.() === editor;
}
