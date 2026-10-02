import { test } from "node:test";
import assert from "node:assert/strict";
import "../../tests/fixtures/tool-display/pi-tui.mjs"; // lets index.ts load pi-tui in plain node

const { editorFocused } = await import("./index.ts");

const fn = () => {};
const editor = () => ({ onSubmit: fn, getText: fn, handleInput: fn });
/** Pi's root: seven containers, the fifth holding `slot`. */
const tree = (slot, focused = slot) => ({
  children: [{}, {}, {}, {}, { children: [slot] }, {}, {}],
  getFocusedComponent: () => focused,
});

test("the main editor in the slot and in focus", () => {
  assert.equal(editorFocused(tree(editor()), "0.87.1"), true);
});

test("a picker in the editor slot is not the editor", () => {
  const picker = { handleInput: fn, getText: fn }; // no onSubmit
  assert.equal(editorFocused(tree(picker), "0.87.1"), false);
});

test("the editor in the slot but something else focused", () => {
  assert.equal(editorFocused(tree(editor(), { handleInput: fn }), "0.87.1"), false);
});

test("the probe decides, not the version", () => {
  assert.equal(editorFocused(tree(editor()), "0.88.0"), true);
  assert.equal(editorFocused(tree(editor()), "1.0.0"), true);
  const picker = { handleInput: fn, getText: fn }; // no onSubmit
  assert.equal(editorFocused(tree(picker), "1.0.0"), false);
});

test("the editor slot is walked, not hardcoded", () => {
  const slot = { children: [editor()] };
  const moved = { children: [{}, slot, {}, {}, {}, {}, {}], getFocusedComponent: () => slot.children[0] };
  assert.equal(editorFocused(moved, "1.0.0"), true);
});

/** Pi 1.0.0's tree: 7 children, the editor at index 4, a 3-child documentContainer first. */
const pi1 = (slot, focused = slot) => ({
  children: [{ children: [{}, {}, {}] }, {}, {}, {}, { children: [slot] }, {}, {}],
  getFocusedComponent: () => focused,
});

test("Pi 1.0.0's tree focuses the editor without version help", () => {
  assert.equal(editorFocused(pi1(editor()), "1.0.0"), true);
  assert.equal(editorFocused(pi1(editor()), "0.87.1"), true, "the version is ignored either way");
});

test("a missing or short tree is not the editor", () => {
  assert.equal(editorFocused(undefined, "0.87.1"), false);
  assert.equal(editorFocused({ children: [] }, "0.87.1"), false);
});
