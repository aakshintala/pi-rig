# status

The status extension provides a two-line footer and quota information from the local QuotaBar feed. The staged consumer supports feed v1 through the existing `GET /quotas` route. The installed extension has not been switched to the daemon feed.

One client shares the footer, `get_quotas` and `/quota`. Concurrent requests join one fetch. The client keeps the existing 8-second tool timeout, 5-second footer timeout and TUI refresh schedule. It does not add a polling loop.

## Footer

The footer replaces Pi's footer in TUI sessions.

```text
model thinking  │  in 12k out 3.4k cache 81% $0.412  │  ctx [███░░░░░░░] 31%
~/repo main*  │  Q claude 78%/41% · codex 12% · muse unknown busy  │  TTFT 820ms · TPS 64.2
```

The footer uses provider severity from the feed. It does not infer quota health from percentage thresholds. It shows percentage, balance and count meters, including providers with no current reading. It marks stale readings with their age and shows safe recovery guidance for feed error codes.

Context turns amber at 70% and red at 90%. Usage totals cover the current branch and update per message, not per draw. Tokens and cost count each finished subagent once. `*` marks uncommitted changes.

Git status runs in the background at session start and 300 ms after the last tool call. It runs one process at a time, only in trusted projects, and stops on shutdown. It does not run repository code: fsmonitor, hooks and repo-configured clean filters are disabled, and submodules are compared by commit only.

## Quota tool

`get_quotas({ provider? })` shows one compact line per provider. It includes remaining percentage, balance or used/limit count, server status, capture age and safe recovery guidance. It includes reset times for buckets that are not healthy. Output stays within 400 characters.

## Quota command

`/quota` shows every provider and bucket, including reset times, status, capture age and safe error guidance. Invalid or unsupported feed v1 data is reported separately from an unavailable daemon. The client does not print raw response bodies or parser errors.

## Refresh behavior

In TUI sessions, the client fetches when the session starts and every `quotaRefreshSeconds`. It stops on shutdown, reload and session switch. Tool and command calls reuse a cached feed younger than the interval; otherwise they join a fetch. A failed refresh keeps a cached feed only until its local cache interval expires. The footer recomputes capture age when Pi renders it, so an unchanged feed can become visibly stale without another request.

## Settings

Settings live in the `status` section of `rig.json`.

| Key | Default | Meaning |
|---|---:|---|
| `quota` | `true` | Disable quota tool, command, refreshes and footer segment. Apply the change on reload. |
| `quotaPort` | `8787` | Loopback feed port, from 1 to 65535. |
| `quotaRefreshSeconds` | `60` | Refresh interval, from 5 to 3600 seconds. |

A port change clears the cached feed. An interval change retimes the existing TUI refresh schedule.

This documentation describes staged feed v1 support. It does not install or activate the daemon consumer. The current installed client remains unchanged until a separately approved cutover.
