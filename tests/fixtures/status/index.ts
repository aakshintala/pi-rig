// Test-only wrapper for the status TUI tests: makes pi's cwd a clean git repo
// on branch main (before pi's footer looks for one), serves a fixed quota feed
// instead of QuotaBar.app, and is loaded in place of the status extension.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import status from "../../../extensions/status/index.ts";

const capturedAt = new Date().toISOString();
const bucket = (key: string, label: string, percentRemaining: number, status: "healthy" | "warning" | "critical") => ({
  key, label, percentRemaining, balanceRemaining: null, balanceUsed: null, balanceCap: null, balanceUnit: null,
  unitsUsed: null, unitsLimit: null, resetsAt: null, resetText: null, status,
});
const FEED = {
  schemaVersion: 1,
  generatedAt: capturedAt,
  disabledProviderIds: [],
  providers: [
    { id: "claude", name: "Claude", tier: null, capturedAt, ageSeconds: 0, freshness: "fresh", errorCode: null, status: "warning", quotas: [bucket("session", "Session", 78, "healthy"), bucket("weekly", "Weekly", 41, "warning")] },
    { id: "codex", name: "Codex", tier: null, capturedAt, ageSeconds: 0, freshness: "fresh", errorCode: null, status: "critical", quotas: [bucket("weekly", "Weekly", 12, "critical")] },
  ],
};

export default function (pi: ExtensionAPI) {
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
  if (!existsSync(".git")) {
    // Once: pi runs extension factories again on /new.
    git("init", "-q", "-b", "main");
    writeFileSync("a.txt", "a\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "init");
  }
  status(pi, { fetch: async () => Response.json(FEED) });
}
