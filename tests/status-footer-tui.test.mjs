// The status footer in a real pi (spec #38, ADR 0001): two lines, git dirty
// state after a tool writes a file, a fresh footer after /new, and truncation
// at a narrow width. The
// fixture makes cwd a clean git repo and serves a fixed quota feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { liveGroup, startTui } from "./helpers/tui.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/status/index.ts", import.meta.url));
// Fullscreen: the transcript (`chat`) on top, blank fill, the dock (editor borders + the
// two-line footer) pinned to the bottom of the 24-row pane.
const screen = (chat, dock) => "\n" + [...chat, ...Array(24 - chat.length - dock.length).fill(""), ...dock].join("\n");
const BORDER = "─".repeat(80);

// The pane's rows with their SGR colours. The harness captures plain text only,
// so find this test's tmux server (named pi-rig-<our pid>-*) by its pane's pid.
function colouredScreen(tui) {
  const dir = join(process.env.TMUX_TMPDIR ?? "/tmp", `tmux-${process.getuid()}`);
  const tmux = (name, ...a) => spawnSync("tmux", ["-L", name, ...a], { encoding: "utf8" }).stdout;
  const name = readdirSync(dir).find((n) => n.startsWith(`pi-rig-${process.pid}-`) && Number(tmux(n, "display-message", "-p", "#{pane_pid}")) === tui.pid);
  return tmux(name, "capture-pane", "-p", "-e").split("\n");
}
// Pi 1.0's system theme in 256 colours: accent, warning, error; SGR dim.
const [ACCENT, WARNING, ERROR] = [5, 3, 1].map((c) => (s) => `\x1b[38;5;${c}m${s}`);
const DIM = (s) => `\x1b[2m${s}`;
const OFF = "\x1b[39m";

async function start(t, options) {
  const tui = await startTui(t, { extensions: [FIXTURE], ...options });
  t.after(() => assert.deepEqual(liveGroup(tui.pid), []));
  return tui;
}

test("two-line footer; the dirty mark appears after a tool writes a file", async (t) => {
  const write = { type: "toolCall", id: "c1", name: "write", arguments: { path: "b.txt", content: "b\n" } };
  const tui = await start(t, { replies: [[write], "Done."] });
  await tui.waitForScreen(screen([""], [
    BORDER,
    "",
    BORDER,
    "harness-1 off  │  in 0 out 0 cache -- $0.000  │  ctx [░░░░░░░░░░] 0%",
    "~/cwd main  │  Q claude 78%/41% · codex 12%  │  TTFT -- · TPS --",
  ]));
  // Colours: context in accent below 70%; claude's lowest bucket (41%) in warning, codex (12%) in error.
  const footer = colouredScreen(tui).slice(22, 24);
  assert.ok(footer[0].endsWith(`${ACCENT("ctx [░░░░░░░░░░] 0%")}${OFF}`), JSON.stringify(footer[0]));
  assert.ok(footer[1].includes(`${DIM("Q")}\x1b[0m ${WARNING("claude 78%/41%")}\x1b[2m\x1b[39m · \x1b[0m${ERROR("codex 12%")}${OFF}`), JSON.stringify(footer[1]));

  tui.type("go");
  tui.keys("Enter");
  await tui.waitForEvent("agent_end");
  await tui.waitForScreen(screen(
    ["", " go", "", "", "", " write b.txt", "", " b", "", "", " Done."],
    [
      BORDER,
      "",
      BORDER,
      "harness-1 off  │  in 26 out 12 cache 4% $0.000  │  ctx [░░░░░░░░░░] 0%",
      "~/cwd main*  │  Q claude 78%/41% · codex 12%  │  TTFT -- · TPS --",
    ],
  ));
  const row = colouredScreen(tui).find((r) => r.startsWith("~/cwd"));
  assert.ok(row.startsWith(`~/cwd ${ACCENT("main")}${WARNING("*")}${OFF}`), JSON.stringify(row));

  // A new session starts from zero usage and checks git again at once.
  tui.type("/new");
  tui.keys("Enter");
  await tui.waitForEvent("session_start", 2);
  await tui.waitForScreen(screen(
    ["", "", " ✓ New session started", "", ""],
    [
      BORDER,
      "",
      BORDER,
      "harness-1 off  │  in 0 out 0 cache -- $0.000  │  ctx [░░░░░░░░░░] 0%",
      "~/cwd main*  │  Q claude 78%/41% · codex 12%  │  TTFT -- · TPS --",
    ],
  ));
});

test("footer lines are truncated to a narrow terminal", async (t) => {
  const tui = await start(t, { cols: 40 });
  await tui.waitForScreen(screen([""], [
    "─".repeat(40),
    "",
    "─".repeat(40),
    "harness-1 off  │  in 0 out 0 cache --...",
    "~/cwd main  │  Q claude 78%/41% · cod...",
  ]));
});
