import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import "../../tests/fixtures/tool-display/pi-tui.mjs";
const { compact, createQuotaClient, full, parseFeed, registerQuota, CALL_TIMEOUT_MS, FOOTER_TIMEOUT_MS, MAX_TOOL_CHARS } = await import("./quota.ts");

const provider = (overrides = {}) => ({
  id: "claude", name: "Claude", tier: "Max", capturedAt: "2026-11-04T11:59:00Z", ageSeconds: 60,
  freshness: "fresh", errorCode: null, status: "healthy",
  quotas: [{ key: "session", label: "Session", percentRemaining: 78.4, balanceRemaining: null, balanceUsed: null, balanceCap: null, balanceUnit: null,
    unitsUsed: null, unitsLimit: null, resetsAt: "2026-11-04T12:59:00Z", resetText: "Resets in 1h", status: "healthy" }], ...overrides,
});
const feed = (providers = [provider()]) => ({ schemaVersion: 1, generatedAt: "2026-11-04T12:00:00Z", disabledProviderIds: [], providers });
const FEED = feed([
  provider(),
  provider({ id: "codex", name: "Codex", tier: null, quotas: [{ key: "credits", label: "Credits", percentRemaining: null, balanceRemaining: 12.34, balanceUsed: 1, balanceCap: 13.34, balanceUnit: "usd", unitsUsed: null, unitsLimit: null, resetsAt: null, resetText: null, status: "warning" }], status: "warning" }),
  provider({ id: "cursor", name: "Cursor", tier: "Pro", quotas: [{ key: "monthly", label: "Monthly", percentRemaining: 50, balanceRemaining: null, balanceUsed: null, balanceCap: null, balanceUnit: null, unitsUsed: 30320, unitsLimit: 38298, resetsAt: null, resetText: null, status: "healthy" }] }),
  provider({ id: "muse", name: "Muse", tier: null, capturedAt: null, ageSeconds: null, freshness: "unknown", errorCode: "busy", status: "unknown", quotas: [] }),
]);

function fakeTimers() {
  let id = 0; const timeouts = new Map(), intervals = new Map();
  return { timeouts, intervals, setTimeout: (f, ms) => (timeouts.set(++id, { f, ms }), id), clearTimeout: (i) => timeouts.delete(i),
    setInterval: (f, ms) => (intervals.set(++id, { f, ms }), id), clearInterval: (i) => intervals.delete(i), fireTimeouts: () => [...timeouts.values()].forEach((t) => t.f()), tick: () => [...intervals.values()].forEach((t) => t.f()) };
}
async function feedServer({ body = FEED, hold = false } = {}) {
  const parked = []; let hits = 0;
  const server = createServer((_req, res) => { hits++; const reply = () => res.end(JSON.stringify(body)); hold ? parked.push(reply) : reply(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, hits: () => hits, release: () => parked.splice(0).forEach((f) => f()), close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}
function client(srv, extra = {}) { return createQuotaClient({ port: () => srv.port, refreshMs: () => 60_000, timers: fakeTimers(), ...extra }); }
async function waitFor(cond) { for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setTimeout(r, 2)); assert.ok(cond(), "condition never held"); }

const clone = (v) => structuredClone(v);
test("v1 errorCode accepts only documented values and explicit null", () => {
  const known = ["credentials_missing", "login_expired", "keychain_blocked", "subscription_unavailable", "cooldown", "rate_limited", "network_error", "configuration_error", "busy", "provider_error", "persistence_error", "internal_error"];
  for (const errorCode of [null, ...known]) assert.ok(parseFeed(feed([provider({ errorCode })])), `accepted ${errorCode}`);
  for (const errorCode of ["raw provider response", "toString", "constructor", "__proto__"]) {
    assert.equal(parseFeed(feed([provider({ errorCode })])), null, `rejected ${errorCode}`);
  }
});

test("strict v1 parser accepts explicit nulls, rejects old feed, wrong version and every omitted nullable field", () => {
  assert.deepEqual(parseFeed(FEED), FEED);
  assert.equal(parseFeed({ providers: FEED.providers }), null);
  const wrong = clone(FEED); wrong.schemaVersion = 2; assert.equal(parseFeed(wrong), null);
  for (const [object, field] of [["provider", "tier"], ["provider", "capturedAt"], ["provider", "ageSeconds"], ["provider", "errorCode"],
    ["bucket", "percentRemaining"], ["bucket", "balanceRemaining"], ["bucket", "balanceUsed"], ["bucket", "balanceCap"], ["bucket", "balanceUnit"],
    ["bucket", "unitsUsed"], ["bucket", "unitsLimit"], ["bucket", "resetsAt"], ["bucket", "resetText"]]) {
    const malformed = clone(FEED); const target = object === "provider" ? malformed.providers[0] : malformed.providers[0].quotas[0]; delete target[field];
    assert.equal(parseFeed(malformed), null, `${object}.${field} omission rejected`);
  }
});

test("compact and full render amounts, pace status, reset, unknown, busy, actionable error and effective capture age", () => {
  assert.match(compact(FEED.providers, Date.parse("2026-11-04T12:06:00Z")), /claude \(Max\): session 78%/);
  assert.match(compact(FEED.providers, Date.parse("2026-11-04T12:06:00Z")), /stale 7m/);
  assert.match(compact(FEED.providers), /codex: credits \$12\.34 left \(warning\)/);
  assert.match(compact(FEED.providers), /cursor \(Pro\): monthly 50% \(30320\/38298\)/);
  assert.match(compact(FEED.providers), /muse: unknown, busy; refresh is still in progress/);
  assert.match(full(FEED, Date.parse("2026-11-04T12:00:00Z")), /resets in 59m/);
  const err = feed([provider({ errorCode: "credentials_missing", freshness: "stale" })]);
  assert.match(full(err), /sign in with the provider CLI/);
  const httpFreshLie = feed([provider({ capturedAt: "2020-01-01T00:00:00Z", freshness: "fresh", ageSeconds: 0 })]);
  assert.match(compact(httpFreshLie.providers, Date.parse("2026-11-04T12:00:00Z")), /stale/);
  const oldStaleLabel = feed([provider({ capturedAt: "2026-11-04T11:59:00Z", freshness: "stale", ageSeconds: 999 })]);
  assert.doesNotMatch(compact(oldStaleLabel.providers, Date.parse("2026-11-04T12:00:00Z")), /stale/);
  const future = feed([provider({ capturedAt: "2027-01-01T00:00:00Z" })]);
  assert.match(compact(future.providers, Date.parse("2026-11-04T12:00:00Z")), /unknown age/);
});

test("coalesces concurrent gets, validates same GET v1 route and shares parsed feed", async (t) => {
  const srv = await feedServer({ hold: true }); t.after(srv.close); const c = client(srv);
  const calls = Promise.all([c.get(), c.get({ force: true }), c.get()]); await waitFor(() => srv.hits() === 1); srv.release();
  const [a, b, d] = await calls; assert.equal(srv.hits(), 1); assert.equal(a, b); assert.equal(b, d);
});

test("cache age and forced refresh preserve one local client", async (t) => {
  const srv = await feedServer(); t.after(srv.close); let now = 1000; const c = client(srv, { now: () => now });
  const a = await c.get(); now += 59_000; assert.equal(await c.get(), a); assert.equal(srv.hits(), 1);
  await c.get({ force: true }); assert.equal(srv.hits(), 2); now += 60_000; await c.get(); assert.equal(srv.hits(), 3);
});

test("keeps existing 8s tool and 5s footer timeouts and returns null after timeout", async (t) => {
  assert.equal(CALL_TIMEOUT_MS, 8_000); assert.equal(FOOTER_TIMEOUT_MS, 5_000);
  const srv = await feedServer({ hold: true }); t.after(srv.close); const timers = fakeTimers(); const c = client(srv, { timers }); const p = c.get();
  await waitFor(() => srv.hits() === 1); assert.deepEqual([...timers.timeouts.values()].map((x) => x.ms), [8_000]); timers.fireTimeouts(); assert.equal(await p, null);
});

test("missing and unsupported v1 schema are actionable in get_quotas and /quota", async (t) => {
  const missingSchema = clone(FEED); delete missingSchema.schemaVersion;
  for (const [body, expected] of [[missingSchema, /without schemaVersion/], [{ ...FEED, schemaVersion: 2 }, /schema is unsupported/]]) {
    const srv = await feedServer({ body }); t.after(srv.close);
    const pi = fakePi(); registerQuota(pi, settings(srv.port), { timers: fakeTimers() });
    const tool = (await pi.tools.get_quotas.execute("id", {})).content[0].text;
    assert.match(tool, expected);
    const notes = [];
    await pi.commands.quota.handler("", { ui: { notify: (message) => notes.push(message) } });
    assert.match(notes[0], expected);
    assert.doesNotMatch(`${tool}${notes[0]}`, /raw provider|SyntaxError|JSON at/);
  }
});

test("malformed and non-200 feeds fail safe without exposing response body", async (t) => {
  for (const body of [{ secret: "raw body" }, FEED]) {
    const srv = await feedServer({ body: body === FEED ? body : body }); t.after(srv.close);
    if (body === FEED) continue;
    assert.equal(await client(srv).get(), null);
  }
  const bad = await feedServer({ body: { ...FEED, schemaVersion: 7 } }); t.after(bad.close); assert.equal(await client(bad).get(), null);
  const srv = await feedServer(); t.after(srv.close);
  const c = createQuotaClient({ port: () => srv.port, refreshMs: () => 60_000, fetch: async () => new Response("synthetic secret", { status: 500 }) });
  assert.equal(await c.get(), null);
});

function fakePi() {
  const handlers = {}, tools = {}, commands = {};
  return { handlers, tools, commands, on: (e, h) => (handlers[e] ??= []).push(h), registerTool: (t) => (tools[t.name] = t), registerCommand: (n, c) => (commands[n] = c),
    emit: (e, ev = {}, ctx = {}) => (handlers[e] ?? []).forEach((h) => h(ev, ctx)) };
}
function settings(port) { const values = { quotaPort: port, quotaRefreshSeconds: 60 }, listeners = new Set(); return { get: (k) => values[k], onChange: (l) => (listeners.add(l), () => listeners.delete(l)), set: (k, v) => ((values[k] = v), listeners.forEach((l) => l(k, v))) }; }

test("tool, /quota and footer listener use one client and no CLI/provider invocation", async (t) => {
  const srv = await feedServer(); t.after(srv.close); const pi = fakePi(); const c = registerQuota(pi, settings(srv.port), { timers: fakeTimers() });
  let notified; await pi.tools.get_quotas.execute("id", {}); await pi.commands.quota.handler("", { ui: { notify: (m) => notified = m } });
  assert.match(notified, /Claude \(Max\): healthy/); assert.equal(srv.hits(), 1);
  const observed = []; c.onFeed((v) => observed.push(v)); await c.get({ force: true }); assert.equal(observed.length, 1);
});

test("tool output remains bounded for arbitrary provider and bucket counts", () => {
  const many = Array.from({ length: 40 }, (_, i) => provider({ id: `p${i}`, name: `Provider ${i}`, quotas: [] }));
  const text = compact(many); assert.ok(text.length <= MAX_TOOL_CHARS); assert.match(text, /more; pass provider/);
});

test("existing TUI-only polling lifecycle and port invalidation remain bounded", async (t) => {
  const srv = await feedServer(); t.after(srv.close); const timers = fakeTimers(), pi = fakePi(), s = settings(srv.port);
  registerQuota(pi, s, { timers }); pi.emit("session_start", {}, { mode: "print" }); assert.equal(timers.intervals.size, 0);
  pi.emit("session_start", {}, { mode: "tui" }); assert.equal(timers.intervals.size, 1); pi.emit("session_shutdown"); assert.equal(timers.intervals.size, 0);
  const second = await feedServer(); t.after(second.close); const pi2 = fakePi(), s2 = settings(srv.port), c = registerQuota(pi2, s2, { timers: fakeTimers() });
  await c.get(); s2.set("quotaPort", second.port); await c.get(); assert.equal(srv.hits(), 1); assert.equal(second.hits(), 1);
});

test("session cleanup aborts a fetch so it cannot repopulate cache", async (t) => {
  const srv = await feedServer({ hold: true }); t.after(srv.close); const pi = fakePi(); const c = registerQuota(pi, settings(srv.port), { timers: fakeTimers() });
  const pending = c.get(); await waitFor(() => srv.hits() === 1); pi.emit("session_shutdown"); assert.equal(await pending, null);
});
