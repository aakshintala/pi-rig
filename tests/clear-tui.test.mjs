// /clear in a real pi (#61): starts a new session, as /new does.
import { test } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { liveGroup, startTui } from "./helpers/tui.mjs";

const BORDER = "─".repeat(80);

test("/clear starts a new session with an empty transcript", async (t) => {
  const tui = await startTui(t, { replies: ["pong"], extensions: [fileURLToPath(new URL("../extensions/clear/index.ts", import.meta.url))] });
  t.after(() => assert.deepEqual(liveGroup(tui.pid), []));
  tui.type("ping");
  tui.keys("Enter");
  // Fullscreen: the chat on top (a leading blank, then the turn), blank fill, then the
  // dock (border, editor, border, footer) pinned to the bottom rows.
  await tui.waitForScreen(`\n\n ping\n\n\n pong\n` + "\n".repeat(14) + `${BORDER}

${BORDER}
~/cwd
↑3 ↓1 W3 CH0.0% 0.0%/128k (auto)                                       harness-1`);
  tui.type("/clear");
  tui.keys("Enter");
  await tui.waitForEvent("session_start", 2);
  await tui.waitForScreen("\n" + [...Array(19).fill(""), ...[BORDER, "", BORDER, "~/cwd", "0.0%/128k (auto)                                                       harness-1"]].join("\n"));
});
