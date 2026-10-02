// /theme without live preview: when the internal theme slot does not hold the
// live theme (renamed or dead), moving only moves the cursor, cancel changes
// nothing, and select goes through Pi's setTheme(name).
import "./fixtures/tool-display/pi-tui.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { scriptedSession } from "./helpers/session.mjs";

const theme = (await import("../extensions/theme/index.ts")).default;
const SLOT = Symbol.for("@earendil-works/pi-coding-agent:theme");
const DOWN = "\x1b[B";

// Runs /theme with the given keys against a stub TUI; `slotTheme` replaces the
// global theme slot (a renamed or dead slot), while the UI keeps the live theme.
// Returns the setTheme calls and the active theme's name after each key.
async function run(t, keys, slotTheme) {
  initTheme("dark");
  const live = globalThis[SLOT];
  if (slotTheme !== undefined) globalThis[SLOT] = slotTheme;
  t.after(() => {
    globalThis[SLOT] = live;
  });
  const { session } = await scriptedSession(t, { extensions: [theme] });
  const calls = [];
  const active = [];
  session.extensionRunner.setUIContext(
    {
      notify() {},
      theme: live,
      getTheme: (name) => ({ name, fg: (_k, text) => text }),
      setTheme: (name) => (calls.push(name), { success: true }),
      custom: (factory) =>
        new Promise((done) => {
          const view = factory({ invalidate() {}, requestRender() {} }, live, {}, done);
          for (const key of keys) {
            view.handleInput(key);
            active.push(globalThis[SLOT]?.name);
          }
        }),
    },
    "tui",
  );
  await session.prompt("/theme");
  return { calls, active };
}

test("with the live theme in the slot, moving previews and Esc restores", async (t) => {
  assert.deepEqual(await run(t, [DOWN, "\x1b"]), { calls: [], active: ["light", "dark"] });
});

test("with a renamed slot, moving does not preview and Esc changes nothing", async (t) => {
  const renamed = { name: "other", fg: (_k, text) => text };
  assert.deepEqual(await run(t, [DOWN, "\x1b"], renamed), { calls: [], active: ["other", "other"] });
});

test("with a dead slot, moving does not preview and Esc changes nothing", async (t) => {
  assert.deepEqual(await run(t, [DOWN, "\x1b"], { name: "dark" }), { calls: [], active: ["dark", "dark"] });
});

test("Enter still applies the theme through setTheme(name)", async (t) => {
  assert.deepEqual(await run(t, [DOWN, "\r"]), { calls: ["light"], active: ["light", "light"] });
});
