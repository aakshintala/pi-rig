import { test } from "node:test";
import assert from "node:assert";
import { liveGroup, parseEvents, startTui } from "./helpers/tui.mjs";

test("events file: a partly written last line is not read yet", () => {
  assert.deepEqual(parseEvents('{"event":"a"}\n{"event":"b"}\n{"ev'), ["a", "b"]);
  assert.deepEqual(parseEvents(""), []);
});

test("tmux harness: pi shows a scripted reply", async (t) => {
  const tui = await startTui(t, { replies: ["Hello from the scripted model."] });
  // Registered after the helper's hook, so it runs after cleanup: nothing in pi's
  // process group is still running.
  t.after(() => assert.deepEqual(liveGroup(tui.pid), []));

  tui.type("say hello");
  tui.keys("Enter");
  await tui.waitForEvent("agent_end");

  // All 24 rows of fullscreen mode. Row 1 is blank: pi's quiet-startup header; the
  // chat fills the top, blank rows fill the middle and the dock is pinned to the bottom.
  const screen = `

 say hello


 Hello from the scripted model.














────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────
~/cwd
↑4 ↓8 W4 CH0.0% 0.0%/128k (auto)                                       harness-1`;
  await tui.waitForScreen(screen);

  // A template missing the blank middle rows is not the full screen.
  const short = screen.replace(" Hello from the scripted model.\n\n", " Hello from the scripted model.\n");
  await assert.rejects(tui.waitForScreen(short), /rows/);
});
