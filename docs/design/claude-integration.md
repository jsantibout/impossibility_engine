# Claude integration (M2+)

The orchestration layer above the engine. Verified against the bundled `claude-api` skill; re-check that skill before changing any of it.

## The API

- Model `claude-opus-5`, `thinking: {type: "adaptive"}`, streamed via
  `client.beta.messages.toolRunner({ ..., stream: true })`
- Check `stop_reason === "pause_turn"` each iteration and `pushMessages` to
  resume — **the runner does not auto-resume**, it silently returns a truncated
  turn
- Enable refusal fallbacks (`betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`) and check `stop_reason === "refusal"` before reading
  content. Dark-fantasy narration is exactly the traffic that trips a classifier,
  and a DM that hard-fails mid-combat is a broken product
- **Caching is architecture, not tuning.** The system prefix (persona + DM
  directives) is frozen and carries an explicit `cache_control` breakpoint;
  tools are serialised in stable sorted order. Per-turn game state goes in as a
  `{role: "system"}` message appended to `messages[]` — never by editing
  top-level `system`, which would reprocess the whole campaign uncached every
  turn. An integration test asserts `cache_read_input_tokens > 0` on turn 2+,
  because that failure is silent and expensive
- Never interpolate date, session id, or player name into the system prompt

## The session boundary (`@ie/tools`)

Decided from the probe in `tools/llm-probe`, which already drives a live model
against the engine end to end. `@ie/tools` is above the purity line and may use
Zod, a clock and id generation; the engine below it may not.

**One `Campaign` per content and log.** It owns the seed, the validated
`Content` and the event log, and nothing else. `GameState` is a derived cache
stepped by `applyEvent` — stepping and refolding are the same function
(`fold/apply.ts:206`, `:458`), which `persistence-2.test.ts:367` already
relies on, and a test holds the cache equal to `fold(seed, log)` after every
call. No live `Rng` or `RollIssuer` is held: both are rebuilt per call from
`state.rng` and `state.rollsIssued` and thrown away, as `scenario.test.ts:207`
and the probe's `session.ts:45` do. That is what makes a refusal free — the
generator it never used is discarded. The only non-determinism is the seed,
drawn once when the campaign is created. The command id is the transport's
`tool_use.id`, never a field the model fills.

**Four outcomes on the wire, not three.** `ok` carries the events the call
wrote, its resolution, and any `unverified` clauses the engine could not
check; `refused` carries `code` and `reason`; `needs-context` carries `code`,
`reason` and `establish[]`; `invalid` is Zod rejecting the model's arguments
before any engine call, and is never a rules refusal. The probe's `settle()`
(`surface.ts:321`) is the shape.

**Nobody holds a partial command.** A `needs-context` spent nothing and threw
no die; the model establishes the fact through the named tool and re-sends its
original call, which is what `needsContext` was written to mean
(`result.ts:122`) and what the `route` kind requires by construction. Every
`ContextRequest.kind` must map to a tool that declares it — a kind with no
door is the failure to test for. A session that resumed the held call would
make a decision the transcript does not show, and transcript re-dispatch is
the determinism criterion.

Out of scope until decided: persisting the log (a `Content` holds closures, so
what is stored is the `ContentInput`), and multiple scenes. Two things a later
batch owes: an engine command that rolls Initiative *and* begins combat, so
the tools layer stops hand-writing the one `rolls-issued` a caller assembles
(`commands/initiative.ts:41`); and whether `satisfyWith` becomes a tool name
rather than prose, now that a second consumer reads it.
