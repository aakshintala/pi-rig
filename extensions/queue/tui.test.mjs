// tmux TUI tests for the message queue (ADR 0001: event-synchronised, full-screen asserts).
// The gate fixture holds the agent in a tool call until the test releases it, so input is
// typed while the agent works.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { liveGroup, startTui } from "../../tests/helpers/tui.mjs";

const EXT = new URL("./index.ts", import.meta.url).pathname;
const GATE = new URL("../../tests/fixtures/queue/gate.ts", import.meta.url).pathname;
const TODO = new URL("../todo/index.ts", import.meta.url).pathname;
const OTHER = new URL("../../tests/fixtures/queue/other-widget.ts", import.meta.url).pathname;
const gateCall = [{ type: "toolCall", id: "g1", name: "gate", arguments: {} }];

const ROWS = 24;
const BOTTOM = "─".repeat(80);
const WORKING = "── ● Working ─".padEnd(80, "─");
const CWD = "~/cwd";
const stats = (prefix) => prefix + " ".repeat(71 - prefix.length) + "harness-1";
// Fullscreen: chat on top, the queued rows and status line above the input dock and footer
// at the bottom; the blank fill between them is trimmed right by waitForScreen.
const FULLSCREEN = (top, dock) => "\n" + ["", ...top, ...Array(ROWS - top.length - dock.length - 1).fill(""), ...dock].join("\n");
// The input dock in fullscreen: status line, editor row, border, footer.
const dock = (editor, statsLine) => [WORKING, editor, BOTTOM, CWD, stats(statsLine)];
// Idle: the status line is gone.
const idle = (editor, statsLine) => [BOTTOM, editor, BOTTOM, CWD, stats(statsLine)];

async function start(t, replies) {
  const tui = await startTui(t, { extensions: [GATE, EXT], replies });
  t.after(() => assert.deepEqual(liveGroup(tui.pid), [])); // runs after the helper's cleanup
  tui.type("go");
  tui.keys("Enter");
  await tui.waitForEvent("gate_waiting");
  return tui;
}

const release = (tui) => writeFileSync(join(tui.cwd, "release-1"), "");

for (const [extensions, fullscreen] of [[[EXT, TODO, OTHER], false], [[OTHER, TODO, EXT], false], [[OTHER, TODO, EXT], true]]) {
  test(`steering is above TODOs and other widgets (${extensions[0] === EXT ? "queue first" : "queue last"}, ${fullscreen ? "fullscreen" : "regular"})`, async (t) => {
    const tui = await startTui(t, {
      extensions: [GATE, ...extensions],
      args: ["--tui-mode", fullscreen ? "fullscreen" : "regular"],
      replies: [
        [{ type: "toolCall", id: "t1", name: "todo_write", arguments: { todos: [{ text: "plan", status: "pending" }] } }],
        "Planned.",
        gateCall,
        "Done.",
      ],
    });
    t.after(() => assert.deepEqual(liveGroup(tui.pid), []));
    tui.type("plan");
    tui.keys("Enter");
    await tui.waitForEvent("agent_end");
    tui.type("work");
    tui.keys("Enter");
    await tui.waitForEvent("gate_waiting");
    tui.type("steer me");
    tui.keys("Enter");
    const aboveBoth = (s) => s.includes("steer me") && s.indexOf("Steering (1)") < s.indexOf("◻ plan") && s.indexOf("Steering (1)") < s.indexOf("another widget");
    for (let i = 0; i < 100 && !aboveBoth(tui.screen()); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(aboveBoth(tui.screen()), tui.screen());
    tui.type("/other-widget");
    tui.keys("Enter");
    await waitForText(tui, /another widget updated/);
    for (let i = 0; i < 100 && !aboveBoth(tui.screen()); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(aboveBoth(tui.screen()), tui.screen());
    release(tui);
    await tui.waitForEvent("agent_end", 2);
  });
}

test("queue section above the editor; Option+Up/Down/X edit rows in Pi's editor and the draft comes back", async (t) => {
  const tui = await start(t, [gateCall, "Steered.", "Followed."]);
  const top = [" go", "", "", "", " gate"];
  const statsLine = "↑2 ↓2 W2 CH0.0% 0.0%/128k (auto)";
  const rows = (...queue) => [...queue, ...dock("my draft", statsLine)];
  tui.type("first");
  tui.keys("Enter"); // steering
  tui.type("second");
  tui.keys("M-Enter"); // follow-up
  tui.type("my draft");
  await tui.waitForScreen(
    FULLSCREEN(top, rows(" Steering (1) · next turn", "   first", " Follow-ups (1) · after the run", "   second")),
  );

  tui.keys("M-Up"); // the most recent row leaves the queue and loads into the editor
  await tui.waitForScreen(
    FULLSCREEN(top, [" Steering (1) · next turn", "   first", ...dock("second", statsLine)]),
  );

  tui.keys("M-Up", "M-Down");
  tui.type(" edited");
  tui.keys("Enter"); // saved in place; the draft is back
  await tui.waitForScreen(
    FULLSCREEN(top, rows(" Steering (1) · next turn", "   first", " Follow-ups (1) · after the run", "   second edited")),
  );

  tui.keys("M-Up", "M-Up", "M-x"); // delete "first"; "second edited" is now in the editor
  await tui.waitForScreen(FULLSCREEN(top, dock("second edited", statsLine)));

  tui.keys("Enter"); // saved; wait for it, or the release can deliver the row first and Enter submits the draft
  await tui.waitForScreen(
    FULLSCREEN(top, rows(" Follow-ups (1) · after the run", "   second edited")),
  );

  release(tui);
  await tui.waitForEvent("agent_end", 2);
  await tui.waitForScreen(
    FULLSCREEN(
      [...top, " released", "", "", " Steered.", "", "", " second edited", "", "", " Followed."],
      idle("my draft", "↑23 ↓7 R15 W24 CH39.4% 0.0%/128k (auto)"),
    ),
  );
});

async function waitForText(tui, pattern) {
  for (let i = 0; i < 100 && !pattern.test(tui.screen()); i++) await new Promise((r) => setTimeout(r, 20));
  assert.match(tui.screen(), pattern);
}

test("Esc aborts the running turn and sends its queued steer without another prompt", async (t) => {
  const tui = await start(t, [gateCall, "Steered."]);
  tui.type("keep me");
  tui.keys("Enter", "Escape");
  await tui.waitForEvent("agent_end", 2);
  await waitForText(tui, /keep me[\s\S]*Steered\./);
  assert.match(tui.screen(), /Error: This operation was aborted/);
  assert.doesNotMatch(tui.screen(), /Steering \(1\)/);
});

test("Esc while editing requeues the edited steer and aborts the current turn", async (t) => {
  const tui = await start(t, [gateCall, "Steered."]);
  tui.type("original");
  tui.keys("Enter", "M-Up");
  tui.type(" revised");
  tui.keys("Escape");
  await tui.waitForEvent("agent_end", 2);
  await waitForText(tui, /original revised[\s\S]*Steered\./);
  assert.doesNotMatch(tui.screen(), /Steering \(1\)/);
});

test("/compact and /reload typed while the agent works wait for it, with no error or warning", async (t) => {
  const tui = await start(t, [gateCall, "Done."]);
  const top = [" go", "", "", "", " gate"];
  const statsLine = "↑2 ↓2 W2 CH0.0% 0.0%/128k (auto)";
  const queued = [" Follow-ups (2) · after the run", " ⚙ /compact · runs when idle", " ⚙ /reload · runs when idle"];
  tui.type("/compact");
  tui.keys("Enter");
  tui.type("/reload");
  tui.keys("Enter");
  await tui.waitForScreen(FULLSCREEN(top, [...queued, ...dock("", statsLine)]));

  tui.type("draft kept"); // Pi's /reload clears the editor; the queue puts this back
  // Wait for the full draft to render: release() lets /reload snapshot the editor,
  // and keys still in flight would be clobbered when setEditorText restores it (#104).
  await tui.waitForScreen(FULLSCREEN(top, [...queued, ...dock("draft kept", statsLine)]));

  release(tui);
  await tui.waitForEvent("session_start", 2);
  await tui.waitForScreen(
    FULLSCREEN(
      [...top, " released", "", "", " Done.", "", " Reloaded keybindings, extensions, skills, prompts, themes, and context files", ""],
      idle("draft kept", "↑13 ↓4 R2 W14 CH8.0% 0.0%/128k (auto)"),
    ),
  );
});
