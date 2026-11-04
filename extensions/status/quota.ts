// One quota client: the Rust v1 loopback feed, shared by get_quotas, /quota and the footer.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resultText, toolRenderers } from "../../shared/tool-display/index.ts";

export const FOOTER_TIMEOUT_MS = 5_000;
export const CALL_TIMEOUT_MS = 8_000;
export const MAX_TOOL_CHARS = 400;

export type Bucket = {
  key: string;
  label: string;
  percentRemaining: number | null;
  balanceRemaining: number | null;
  balanceUsed: number | null;
  balanceCap: number | null;
  balanceUnit: "usd" | "credits" | null;
  unitsUsed: number | null;
  unitsLimit: number | null;
  resetsAt: string | null;
  resetText: string | null;
  status: "healthy" | "warning" | "critical" | "depleted";
};
export type Provider = {
  id: string;
  name: string;
  tier: string | null;
  capturedAt: string | null;
  ageSeconds: number | null;
  freshness: "unknown" | "fresh" | "stale";
  errorCode: ErrorCode | null;
  status: "unknown" | "healthy" | "warning" | "critical" | "depleted";
  quotas: Bucket[];
};
export type ErrorCode = "credentials_missing" | "login_expired" | "keychain_blocked" | "subscription_unavailable" | "cooldown" | "rate_limited" | "network_error" | "configuration_error" | "busy" | "provider_error" | "persistence_error" | "internal_error";
export const ERROR_CODES: ErrorCode[] = ["credentials_missing", "login_expired", "keychain_blocked", "subscription_unavailable", "cooldown", "rate_limited", "network_error", "configuration_error", "busy", "provider_error", "persistence_error", "internal_error"];
export type Feed = { schemaVersion: 1; generatedAt: string; disabledProviderIds: string[]; providers: Provider[] };

type Timers = Pick<typeof globalThis, "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval">;
export interface ClientOptions {
  port: () => number;
  refreshMs: () => number;
  fetch?: typeof fetch;
  timers?: Timers;
  now?: () => number;
}
export type QuotaClient = ReturnType<typeof createQuotaClient>;

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const has = (o: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const oneOf = (v: unknown, values: string[]) => str(v) && values.includes(v);

/** Narrow v1 boundary validation: every contract field, including nullable fields, must be present. */
type FeedValidation = { feed: Feed | null; reason: "missing-schema" | "unsupported-schema" | "invalid-feed" | null };
function validateFeed(value: unknown): FeedValidation {
  if (!record(value)) return { feed: null, reason: "invalid-feed" };
  if (!has(value, "schemaVersion")) return { feed: null, reason: "missing-schema" };
  if (value.schemaVersion !== 1) return { feed: null, reason: "unsupported-schema" };
  if (!str(value.generatedAt) ||
      !Array.isArray(value.disabledProviderIds) || !value.disabledProviderIds.every(str) || !Array.isArray(value.providers)) return { feed: null, reason: "invalid-feed" };
  for (const p of value.providers) {
    if (!record(p) || !str(p.id) || !str(p.name) || !has(p, "tier") || !nullable(p.tier, str) ||
        !has(p, "capturedAt") || !nullable(p.capturedAt, str) || !has(p, "ageSeconds") || !nullable(p.ageSeconds, integer) ||
        !oneOf(p.freshness, ["unknown", "fresh", "stale"]) || !has(p, "errorCode") || !nullable(p.errorCode, (v) => oneOf(v, ERROR_CODES)) ||
        !oneOf(p.status, ["unknown", "healthy", "warning", "critical", "depleted"]) || !Array.isArray(p.quotas)) return { feed: null, reason: "invalid-feed" };
    for (const q of p.quotas) {
      if (!record(q) || !str(q.key) || !str(q.label) || !has(q, "percentRemaining") || !nullable(q.percentRemaining, finite) ||
          !has(q, "balanceRemaining") || !nullable(q.balanceRemaining, finite) || !has(q, "balanceUsed") || !nullable(q.balanceUsed, finite) ||
          !has(q, "balanceCap") || !nullable(q.balanceCap, finite) || !has(q, "balanceUnit") || !nullable(q.balanceUnit, (v) => oneOf(v, ["usd", "credits"])) ||
          !has(q, "unitsUsed") || !nullable(q.unitsUsed, integer) || !has(q, "unitsLimit") || !nullable(q.unitsLimit, integer) ||
          !has(q, "resetsAt") || !nullable(q.resetsAt, str) || !has(q, "resetText") || !nullable(q.resetText, str) ||
          !oneOf(q.status, ["healthy", "warning", "critical", "depleted"])) return { feed: null, reason: "invalid-feed" };
    }
  }
  return { feed: value as Feed, reason: null };
}
export function parseFeed(value: unknown): Feed | null { return validateFeed(value).feed; }

export function createQuotaClient({ port, refreshMs, fetch: fetchFn = fetch, timers = globalThis, now = Date.now }: ClientOptions) {
  type Pending = { promise: Promise<Feed | null>; controller: AbortController; timer?: ReturnType<typeof setTimeout>; deadline: number };
  let feed: Feed | null | undefined;
  let fetchedAt = -Infinity;
  let feedFailure: FeedValidation["reason"] = null;
  let epoch = 0;
  let inFlight: Pending | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<(feed: Feed | null | undefined) => void>();
  const cache = (next: Feed | null | undefined) => { feed = next; for (const listener of listeners) listener(next); };

  async function run(p: Pending): Promise<Feed | null> {
    const at = epoch;
    try {
      const res = await fetchFn(`http://127.0.0.1:${port()}/quotas`, { signal: p.controller.signal });
      if (!res.ok) throw new Error("feed request failed");
      let payload: unknown;
      try { payload = await res.json(); } catch {
        if (at === epoch) feedFailure = "invalid-feed";
        throw new Error("invalid quota feed");
      }
      const validation = validateFeed(payload);
      if (at !== epoch) return feed ?? null;
      if (!validation.feed) { feedFailure = validation.reason; throw new Error("invalid quota feed"); }
      feedFailure = null;
      fetchedAt = now();
      cache(validation.feed);
    } catch {
      if (at === epoch) cache(now() - fetchedAt < refreshMs() ? feed : null);
    } finally {
      timers.clearTimeout(p.timer);
      if (inFlight === p) inFlight = null;
    }
    return feed ?? null;
  }
  function arm(p: Pending, timeoutMs: number) {
    const deadline = now() + timeoutMs;
    if (deadline <= p.deadline) return;
    p.deadline = deadline;
    timers.clearTimeout(p.timer);
    p.timer = timers.setTimeout(() => p.controller.abort(), timeoutMs);
  }
  const refresh = () => void client.get({ force: true, timeoutMs: FOOTER_TIMEOUT_MS });
  const client = {
    get({ force = false, timeoutMs = CALL_TIMEOUT_MS }: { force?: boolean; timeoutMs?: number } = {}): Promise<Feed | null> {
      if (!force && feed && now() - fetchedAt < refreshMs()) return Promise.resolve(feed);
      let p = inFlight;
      if (!p) { feedFailure = null; p = inFlight = { controller: new AbortController(), deadline: -Infinity } as Pending; arm(p, timeoutMs); p.promise = run(p); }
      else arm(p, timeoutMs);
      return p.promise;
    },
    start() { if (poll) return; refresh(); poll = timers.setInterval(refresh, refreshMs()); },
    retime() { if (poll) { timers.clearInterval(poll); poll = timers.setInterval(refresh, refreshMs()); } },
    invalidate() { epoch++; inFlight?.controller.abort(); inFlight = null; fetchedAt = -Infinity; feedFailure = null; cache(undefined); },
    onFeed(listener: (feed: Feed | null | undefined) => void) { listeners.add(listener); return () => listeners.delete(listener); },
    failureText() { return feedFailure ? FEED_FAILURE_TEXT[feedFailure] : null; },
    stop() { epoch++; if (poll) timers.clearInterval(poll); poll = undefined; inFlight?.controller.abort(); inFlight = null; },
  };
  return client;
}

const FEED_FAILURE_TEXT: Record<Exclude<FeedValidation["reason"], null>, string> = {
  "missing-schema": "QuotaBar returned a feed without schemaVersion; update the daemon to feed v1.",
  "unsupported-schema": "QuotaBar feed schema is unsupported; use a matching v1 daemon and client.",
  "invalid-feed": "QuotaBar returned an invalid v1 feed; update or repair the daemon.",
};
export const unavailableText = (port: number) => `QuotaBar daemon unavailable on 127.0.0.1:${port}; start the installed quotabard daemon.`;
const issueAction: Record<string, string> = {
  credentials_missing: "sign in with the provider CLI", login_expired: "renew the provider CLI login",
  keychain_blocked: "check Keychain access without prompting", subscription_unavailable: "check the provider subscription",
  cooldown: "retry after the provider cooldown", rate_limited: "retry after the provider rate limit",
  network_error: "check connectivity and retry", configuration_error: "fix ~/.quotabar/daemon.json",
  busy: "refresh is still in progress", provider_error: "retry or inspect local daemon logs",
  persistence_error: "fix local state persistence before retrying", internal_error: "inspect local daemon logs",
};
export function captureAge(provider: Pick<Provider, "capturedAt">, now: number): { label: string; seconds: number | null } {
  if (!provider.capturedAt) return { label: "unknown age", seconds: null };
  const captured = Date.parse(provider.capturedAt);
  if (!Number.isFinite(captured) || captured > now) return { label: "unknown age", seconds: null };
  const seconds = Math.floor((now - captured) / 1000);
  const fresh = seconds < 300 ? "fresh" : "stale";
  const value = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
  return { label: `${fresh} ${value}`, seconds };
}
export function errorAction(errorCode: ErrorCode | null): string | undefined {
  return errorCode && has(issueAction, errorCode) ? issueAction[errorCode] : undefined;
}
function issue(provider: Provider): string | null {
  const action = errorAction(provider.errorCode);
  return action ? `; ${action}` : null;
}
function providerState(provider: Provider, now: number): string | null {
  const a = captureAge(provider, now);
  if (provider.status === "unknown" || provider.freshness === "unknown" || !provider.quotas.length) {
    return `unknown${provider.errorCode === "busy" ? ", busy" : ""}${issue(provider) ?? "; no current quota reading"}`;
  }
  if (a.label === "unknown age") return `unknown age${issue(provider) ?? ""}`;
  return a.label.startsWith("stale") ? `${a.label}${provider.errorCode ? issue(provider) : ""}` : provider.errorCode ? `${a.label}${issue(provider)}` : null;
}
function until(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso); if (!Number.isFinite(at)) return null;
  const min = Math.floor((at - now) / 60_000); if (min <= 0) return "soon";
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return d ? `${d}d${h ? `${h}h` : ""}` : h ? `${h}h${m ? `${m}m` : ""}` : `${m}m`;
}
const num = (n: number, digits: number) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 });
const balance = (q: Bucket) => q.balanceRemaining === null ? null : `${q.balanceUnit === "credits" ? `${num(q.balanceRemaining, 0)} credits` : `$${num(q.balanceRemaining, 2)}`} left`;
const amount = (q: Bucket) => q.percentRemaining !== null ? `${Math.round(q.percentRemaining)}%` : balance(q) ?? "?";
const extra = (q: Bucket) => q.unitsUsed !== null && q.unitsLimit !== null ? `${q.unitsUsed}/${q.unitsLimit}` : q.percentRemaining !== null ? balance(q) : null;
const head = (p: Provider) => `${p.id}${p.tier ? ` (${p.tier})` : ""}`;
const clip = (s: string, max = MAX_TOOL_CHARS) => s.length <= max ? s : `${s.slice(0, max - 1)}…`;
function fit(lines: string[]): string {
  if (lines.join("\n").length <= MAX_TOOL_CHARS) return lines.join("\n");
  const more = (n: number) => `\n+${n} more; pass provider for one`;
  const kept: string[] = [];
  for (const line of lines) {
    if ([...kept, line].join("\n").length + more(lines.length - kept.length - 1).length > MAX_TOOL_CHARS) break;
    kept.push(line);
  }
  if (!kept.length) kept.push(clip(lines[0], MAX_TOOL_CHARS - more(lines.length - 1).length));
  const left = lines.length - kept.length;
  return kept.join("\n") + (left ? more(left) : "");
}

/** Compact one-line-per-provider output; all ages use capturedAt, never HTTP freshness claims alone. */
export function compact(providers: Provider[], now = Date.now()): string {
  return fit(providers.map((p) => {
    const state = providerState(p, now);
    if (!p.quotas.length || p.status === "unknown") return `${head(p)}: ${state}`;
    const buckets = p.quotas.map((q) => {
      const reset = until(q.resetsAt, now);
      const notes = [extra(q), q.status !== "healthy" && (reset ? `${q.status}, resets ${reset}` : q.status)].filter(Boolean);
      return `${q.label.toLowerCase()} ${amount(q)}${notes.length ? ` (${notes.join("; ")})` : ""}`;
    }).join(" · ");
    return `${head(p)}: ${buckets}${state ? ` [${state}]` : ""}`;
  }));
}
export function full(feed: Feed, now = Date.now()): string {
  const lines: string[] = [];
  for (const p of feed.providers) {
    const state = providerState(p, now);
    lines.push(`${p.name}${p.tier ? ` (${p.tier})` : ""}: ${p.status}${state ? `, ${state}` : ""}`);
    for (const q of p.quotas) {
      const reset = until(q.resetsAt, now);
      const parts = [q.percentRemaining !== null ? `${amount(q)} left` : amount(q), extra(q), reset && `resets in ${reset}`, q.status];
      lines.push(`  ${q.label}: ${parts.filter(Boolean).join(", ")}`);
    }
  }
  if (feed.disabledProviderIds.length) lines.push(`Disabled in QuotaBar: ${feed.disabledProviderIds.join(", ")}`);
  return lines.join("\n");
}

type Settings = { get(key: string): unknown; onChange?(listener: (key: string) => void): () => void };
export function registerQuota(pi: ExtensionAPI, settings: Settings, deps: Partial<ClientOptions> = {}): QuotaClient {
  const port = () => settings.get("quotaPort") as number;
  const client = createQuotaClient({ port, refreshMs: () => (settings.get("quotaRefreshSeconds") as number) * 1000, ...deps });
  pi.on("session_start", (_event, ctx) => { if (ctx.mode === "tui") client.start(); });
  const off = settings.onChange?.((key) => { if (key === "quotaRefreshSeconds") client.retime(); if (key === "quotaPort") client.invalidate(); });
  pi.on("session_shutdown", () => { client.stop(); off?.(); });
  pi.registerTool({
    name: "get_quotas", label: "Get Quotas",
    description: "Remaining subscription quota per AI provider from the local QuotaBar daemon. Shows quota amounts, status, capture age and safe recovery guidance.",
    parameters: { type: "object", properties: { provider: { type: "string", description: "Provider id, e.g. claude, codex, cursor. Omit for all." } } } as never,
    ...toolRenderers({ title: "GetQuotas", arg: (a: { provider?: string }) => a.provider ?? "", result: (r, _a, _e, theme) => ({ summary: "Checked quotas", body: resultText(r).split("\n").map((l) => theme.fg("toolOutput", l)) }), summary: { verb: "checked", many: "quotas" } }),
    async execute(_id, params: { provider?: string }) {
      const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: undefined });
      const feed = await client.get();
      if (!feed) return text(client.failureText() ?? unavailableText(port()));
      const selected = params.provider ? feed.providers.filter((p) => p.id.toLowerCase() === params.provider!.toLowerCase()) : feed.providers;
      if (!selected.length) return text(clip(`Unknown provider ${params.provider}; known: ${feed.providers.map((p) => p.id).join(", ")}`));
      return text(compact(selected));
    },
  });
  pi.registerCommand("quota", { description: "Show the full QuotaBar feed", handler: async (_args, ctx) => {
    const feed = await client.get();
    if (feed) ctx.ui.notify(full(feed), "info"); else ctx.ui.notify(client.failureText() ?? unavailableText(port()), "warning");
  } });
  return client;
}
