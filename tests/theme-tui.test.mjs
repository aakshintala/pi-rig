// /theme in a real pi (#61): Pi's own picker, live preview, select persists
// through Pi, cancel restores the old theme and writes nothing.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { liveGroup, startTui } from "./helpers/tui.mjs";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const extensions = [root("extensions/theme/index.ts"), root("tests/fixtures/theme/probe.ts")];
const BORDER = "─".repeat(80);
const FOOTER = "~/cwd\n0.0%/128k (auto)                                                       harness-1";
const ROWS = 24;
// Fullscreen: the chat (ending in the widget row) on top, the dock pinned to the
// bottom. `body` is the editor slot: the /theme picker replaces the blank editor row.
const screen = (name, body = []) => {
  body = [].concat(body);
  const dock = [BORDER, ...(body.length ? body : [""]), BORDER, "~/cwd", "0.0%/128k (auto)                                                       harness-1"];
  return "\n" + [...Array(ROWS - 1 - dock.length).fill(""), `theme: ${name}`, ...dock].join("\n");
};
const picker = (name, cursor, current = cursor) =>
  screen(
    name,
    ["system", "dark", "light"].map(
      (n) => `${n === cursor ? "→" : " "} ${n.padEnd(12)}${n === current ? "(current)" : ""}`.trimEnd(),
    ),
  );

// Pi saves settings on its write queue, after the redraw, so wait for the file itself.
function waitForSetting(path, key, want) {
  const read = () => {
    try {
      return JSON.parse(readFileSync(path, "utf8"))[key];
    } catch {
      return undefined; // missing or caught mid-write
    }
  };
  return new Promise((resolve, reject) => {
    let watcher;
    const finish = (err) => {
      watcher?.close();
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const check = () => read() === want && finish();
    const timer = setTimeout(
      () => finish(new Error(`settings.json ${key} is ${JSON.stringify(read())}, never ${JSON.stringify(want)}`)),
      20_000,
    );
    try {
      // The directory, not the file: a file watcher goes silent after a tmp + rename write.
      watcher = watch(dirname(path), (_event, name) => (!name || name === basename(path)) && check());
      watcher.on("error", finish);
    } catch (err) {
      return finish(err);
    }
    check(); // after the watcher starts, so no write slips between
  });
}

// /reload awaits Pi's settings write queue before it starts the session again, so once
// session_start number `starts` arrives, any save the steps before it queued is on disk.
async function drainSettings(tui, starts) {
  tui.type("/reload");
  tui.keys("Enter");
  await tui.waitForEvent("session_start", starts);
}

async function open(t) {
  const tui = await startTui(t, { extensions });
  t.after(() => assert.deepEqual(liveGroup(tui.pid), []));
  const path = join(dirname(tui.home), "agent", "settings.json");
  const settings = () => JSON.parse(readFileSync(path, "utf8"));
  await tui.waitForScreen(screen("system"));
  tui.type("/theme");
  tui.keys("Enter");
  await tui.waitForScreen(picker("system", "system"));
  tui.keys("Down");
  await tui.waitForScreen(picker("dark", "dark", "system")); // preview
  return { tui, settings, path };
}

test("/theme previews on move and Esc restores the old theme without saving", async (t) => {
  const { tui, settings } = await open(t);
  tui.keys("Escape");
  await tui.waitForScreen(screen("system"));
  await drainSettings(tui, 2);
  assert.equal(settings().theme, undefined);
});

test("/theme Enter applies the theme and Pi saves it", async (t) => {
  const { tui, path } = await open(t);
  tui.keys("Enter");
  await tui.waitForScreen(screen("dark"));
  await waitForSetting(path, "theme", "dark");
});

// After /reload with an automatic light/dark setting: the notice sits in the chat above.
const RELOADED = " Reloaded keybindings, extensions, skills, prompts, themes, and context files";
const autoScreen = (name, body = []) => {
  body = [].concat(body);
  const dock = [BORDER, ...(body.length ? body : [""]), BORDER, "~/cwd", "0.0%/128k (auto)                                                       harness-1"];
  return "\n" + ["", RELOADED, ...Array(ROWS - 2 - 1 - dock.length).fill(""), `theme: ${name}`, ...dock].join("\n");
};

test("/theme cancel keeps Pi following the terminal's light/dark scheme", async (t) => {
  const tui = await startTui(t, { extensions });
  t.after(() => assert.deepEqual(liveGroup(tui.pid), []));
  const path = join(dirname(tui.home), "agent", "settings.json");
  const auto = JSON.stringify({ quietStartup: true, theme: "light/dark" });
  writeFileSync(path, auto);
  tui.type("/reload");
  tui.keys("Enter");
  await tui.waitForScreen(autoScreen("dark"));

  tui.type("/theme");
  tui.keys("Enter");
  await tui.waitForScreen(autoScreen("dark", ["  system", "→ dark        (current)", "  light"]));
  tui.keys("Down");
  await tui.waitForScreen(autoScreen("light", ["  system", "  dark        (current)", "→ light"])); // preview
  tui.keys("Escape");
  await tui.waitForScreen(autoScreen("dark"));

  tui.type("\x1b[?997;2n"); // the terminal reports that it switched to light
  await tui.waitForScreen(autoScreen("light"));
  await drainSettings(tui, 3);
  assert.equal(readFileSync(path, "utf8"), auto);
});
