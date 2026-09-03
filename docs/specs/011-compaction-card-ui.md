# Batch 011 spec: compaction-card-ui

Spec status: closed

## Problem Statement

Context compaction runs invisibly in an agent runtime session. The workbench chat shows nothing for it. The current trace line for a compaction folds to nothing because no tool card is running. `case 'trace'` at `lib/workbench/session-store.ts:1184-1204` attaches a trace to the running tool card. A compaction runs at a model boundary, not inside a tool, so `runningToolIndex` returns -1 and the line disappears. The operator watches a long build with no record that the driver context was compressed.

The thinking card proves the pattern this batch needs. The runner emits durable `message_update` frames that carry the growing reasoning text, a durable `thinking_end` marker settles the bar, and the workbench fold rebuilds the same card on refresh. The compaction summarizer call is the same shape: a model call that produces one growing text. It deserves the same card, with a compaction-specific icon and a token label.

The task: mirror the thinking card end to end for compaction. The summarizer streams its output. The card appears inline where compaction happened, between turns. It survives refresh. It expands to the full summary text.

## Solution

Three slices build the card on the proven thinking pipeline.

- S01: the compaction summarizer streams through `streamLLM`, and the runtime emits three new durable lifecycle events: `compaction_start`, `compaction_delta`, `compaction_end`. The end event carries the entry id, the before and after token counts, and the full summary text.
- S02: the workbench fold learns the three events. A compaction card node appears inline, streams its preview, and settles on the end event. Replay rebuilds the same card.
- S03: a new card component renders the card with a compaction icon, a running label, a settled token label, and an expandable full-text body. The copy lives in the workbench i18n map across all twelve locales.

The current one-line `trace` emission stays. It is diagnostic text and backward compatible. The card is the product surface.

## User Stories

1. As an operator, I want to see a card when the agent compacts context, so that long builds explain the pause and the token savings.
2. As an operator, I want the summary text to stream into the card while the summarizer runs, so that the card feels live like the thinking bar.
3. As an operator, I want the settled card to read "Compacted 112K -> 24K", so that I see the before and after context size at a glance.
4. As an operator, I want to expand the card to read the full summary, so that I can audit what the agent kept and what it dropped.
5. As an operator, I want the card to survive a refresh, so that a reloaded session shows the same compaction record the live run did.

## Slices

### S01 Server-side streaming and durable events (tier 3)

**Target symbols.**

- `lib/agent-runtime/lifecycle.ts` :: `HOST_AGENT_LIFECYCLE` (kind constant, existing).
- `lib/server/agent-runtime/compaction.ts` :: `CompactionCardEvent` (kind type, new).
- `lib/server/agent-runtime/compaction.ts` :: `CompactionRuntimeOptions` (kind interface, existing).
- `lib/server/agent-runtime/compaction.ts` :: `generateCompactionSummary` (kind function, existing).
- `lib/server/agent-runtime/compaction.ts` :: `makeCompactionRuntime` (kind function, existing).
- `lib/server/agent-runtime/runner.ts` :: `runSession` (kind function, existing).
- `packages/@openmaic/storage/src/agent-session/types.ts` :: `AgentSessionEventLog` (kind interface, existing).
- `packages/@openmaic/storage/src/agent-session/pg.ts` :: `pruneCompactionDeltas` (kind method, new).
- `packages/@openmaic/storage/package.json` :: version (the storage package publishes, so a touched package source requires a version bump in the same PR).

**Before-state capture facts.**

- The runner subscribes to pi events at `runner.ts:1533-1538` and forwards them through `emit`. `emit` at `runner.ts:985-1046` throttles `message_update` frames to 150 ms (`MESSAGE_UPDATE_MIN_INTERVAL_MS`, `runner.ts:104`), snapshots data for the log, and appends durably through the serial chain `appendEvent` at `runner.ts:962-983`.
- `thinking_end` is appended as a durable marker the moment a message shows text after thinking (`runner.ts:1036-1045`). It carries no text.
- `message_update` frames are pruned to first and last on `message_end` via `store.pruneMessageUpdates` (`runner.ts:975-981`, `pg.ts:879-912`). The durable log stays slim.
- The compaction runtime already takes injected sinks: `summarizer`, `appendSink`, `emitTrace` in `CompactionRuntimeOptions` (`compaction.ts:104-126`). The summarizer call is at `compaction.ts:201-206`, the entry write at `compaction.ts:207-211`, the after-context token count at `compaction.ts:218-219`, and the single trace emit at `compaction.ts:228-230`.
- `generateCompactionSummary` calls `callLLM` through a dynamic import (`compaction.ts:262-284`). It resolves the single stage `maic-agent-compaction` with no fallback (`compaction.ts:271`).
- `streamLLM` is the streaming twin: signature `streamLLM<T extends StreamTextParams>(params: T, source: string, thinking?: ThinkingConfig): StreamTextResult<any, any>` (`lib/ai/llm.ts:503-530`). The driver streams through it in `stream-fn.ts:400-439`, consuming `result.fullStream` and mapping `text-delta` parts at `stream-fn.ts:190-202`.
- The events table `agent_session_events` has no type check constraint (`pg.ts:126-135`). The `type_known_v2` check at `pg.ts:172-202` constrains the separate owner activity feed table, not the run log. New event types need no migration.
- The workbench event subscription is derived from `HOST_AGENT_LIFECYCLE` (`use-workbench-session.ts:92-96`, pinned by `tests/workbench/session-events-subscription.test.ts:24-30`). New lifecycle names reach the browser automatically.
- The lint entry guard and the neutrality guard: compaction.ts imports from `@/lib/ai/llm`, never from `ai`. The guard matrix is `tests/lint-llm-entry-guard.test.ts`. `lib/server/agent-runtime/compaction.ts` and `lib/agent-runtime/lifecycle.ts` are not in the provider-neutral file list (`tests/providers/provider-neutrality-guard.test.ts:58-90`), and none of the chosen event names carries a vendor term.

**Postcondition (per target symbol).**

- `HOST_AGENT_LIFECYCLE`: after-exists true. after-kind constant. The object gains `compactionStart: 'compaction_start'`, `compactionDelta: 'compaction_delta'`, `compactionEnd: 'compaction_end'`. The derived type `HostAgentLifecycleEventType` widens with them.
- `CompactionCardEvent`: after-exists true. after-kind type. Discriminated union:
  `{ kind: 'start'; tokensBefore: number; messagesBefore: number } | { kind: 'delta'; text: string } | { kind: 'end'; entryId: string; tokensBefore: number; tokensAfter: number; summary: string }`.
- `CompactionRuntimeOptions`: after-exists true. after-kind interface. Gains `emitEvent?: (event: CompactionCardEvent) => void`. The `summarizer` function type gains an `onDelta: (text: string) => void` parameter before the abort signal.
- `generateCompactionSummary`: after-exists true. after-kind function. after-signature `(messages: AgentMessage[], focus: string, maxOutputTokens: number, onDelta: (text: string) => void, signal?: AbortSignal): Promise<string>`.
- The function streams through `streamLLM` with stage `maic-agent-compaction` and calls `onDelta` with the accumulated text on every text delta. It never imports `generateText` or `streamText`.
- `makeCompactionRuntime`: after-exists true. after-kind function. after-signature `(opts: CompactionRuntimeOptions): CompactionRuntime`. The signature is unchanged.
- The runtime emits `{ kind: 'start' }` before the summarizer call, `{ kind: 'delta' }` with the accumulated text on every summarizer delta, and `{ kind: 'end' }` after the context rebuild with the entry id and both token counts. A failed compaction emits no end event and returns the input unchanged, exactly as today.
- `runSession`: after-exists true. after-kind function. The signature is unchanged.
- The runner wires `emitEvent` to `emit` for the three lifecycle names, throttles `compaction_delta` with the same 150 ms window, and calls `store.pruneCompactionDeltas(id, seq)` when the end event is appended.
- `AgentSessionEventLog`: after-exists true. after-kind interface. after-signature on the new member `pruneCompactionDeltas(sessionId: string, compactionEndSeq: number): Promise<number>`.
- `pruneCompactionDeltas`: after-exists true. after-kind method. The method deletes the middle `compaction_delta` rows between the enclosing `compaction_start` boundary and the end seq, keeping the first and the last, mirroring `pruneMessageUpdates`.

**Per-target success expectations.**

- A mocked `streamLLM` yields text deltas, and each delta reaches `onDelta` with the full accumulated text. The call uses stage `maic-agent-compaction`.
- A runtime transform against a triggered context emits start, one or more deltas, then end, in that order, with the end event's `summary`, `tokensBefore`, and `tokensAfter` matching the recorded trace event.
- A failing summarizer records the failure in `getTrace().failures`, appends no entry, and emits no end event.
- The disabled runtime emits nothing.
- The durable log holds `compaction_start`, the first and last `compaction_delta`, and `compaction_end` after the prune. The end event's data survives replay verbatim.
- The lint guard stays green. No vendor term enters a neutral file.
- `tests/agent-runtime/runner-event-order.test.ts` still passes with the store mock extended by `pruneCompactionDeltas`.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/compaction-summary.test.ts` expect `passed`. The suite is rewritten for the streaming summarizer: a mocked `streamLLM` returns a fake `fullStream`, `onDelta` receives the growth, and the stage resolution assert survives.
- G02 (unit): `npx vitest run tests/agent-runtime/compaction-runtime.test.ts` expect `passed`. New cases drive the injected `emitEvent` sink and assert start-before-delta-before-end ordering and the no-end-on-failure rule.
- G03 (integration): `npx vitest run tests/lint-llm-entry-guard.test.ts` expect `passed`.
- G04 (integration): `npx vitest run tests/agent-runtime/runner-event-order.test.ts` expect `passed`. The harness proves the default-off deployment emits no compaction frames and the lifecycle-first ordering holds.
- G05 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

### S02 Workbench fold and replay (tier 3)

**Target symbols.**

- `lib/workbench/session-store.ts` :: `ChatNodeKind` (kind type, existing).
- `lib/workbench/session-store.ts` :: `ChatNode` (kind interface, existing).
- `lib/workbench/session-store.ts` :: `WorkbenchFold` (kind interface, existing).
- `lib/workbench/session-store.ts` :: `createInitialSessionState` (kind function, existing).
- `lib/workbench/session-store.ts` :: `foldEvent` (kind function, existing).
- `lib/workbench/session-store.ts` :: `compactReplayEvents` (kind function, existing).
- `lib/workbench/session-store.ts` :: `appendCompactedReplayEvent` (kind function, existing).

**Before-state capture facts.**

- The fold converts the open waiting node into a thinking node on the first thinking frame (`session-store.ts:1242-1256`) and creates one when no waiting node exists (`session-store.ts:1261-1272`). `thinkingKey` is the pointer that later frames reuse.
- `thinking_end` settles the streaming bar without text (`session-store.ts:1205-1211`, `settleStreamingThinking` at `session-store.ts:753-757`).
- The settle fallbacks are durable boundaries in the log: `message_start` at `session-store.ts:1223`, skill-load `message_end` at `session-store.ts:1331`, and `session_end` at `session-store.ts:1747`. These make a killed run's duration converge live and after refresh.
- Replay keeps the first and last `message_update` of each run (`REPLAY_STREAMING` at `session-store.ts:1758`, `compactReplayEvents` at `session-store.ts:1769-1797`, `appendCompactedReplayEvent` at `session-store.ts:1800-1823`). The last frame carries the full text.
- `hasTurnParts` at `session-store.ts:700-707` decides when the three-dot gap may show. It counts `thinking`, `tool`, and `assistant` as turn parts.
- `createInitialSessionState` at `session-store.ts:511-560` is the total reset. `tests/workbench/draft-conversation-reset.test.ts:141-202` walks its keys, so a new fold field is caught there.

**Postcondition (per target symbol).**

- `ChatNodeKind`: after-exists true. after-kind type. The union gains `'compaction'`.
- `ChatNode`: after-exists true. after-kind interface. Gains `tokensBefore?: number`, `tokensAfter?: number`, `entryId?: string` on compaction nodes.
- `WorkbenchFold`: after-exists true. after-kind interface. Gains `compactionKey: string | null`, the pointer to the open compaction node.
- `createInitialSessionState`: after-exists true. after-kind function. After-signature `(): WorkbenchSessionState`. The factory returns `compactionKey: null`.
- `foldEvent`: after-exists true. after-kind function. After-signature `(state: WorkbenchFold, event: WorkbenchEvent): WorkbenchFold`. Three new cases exist:
  - `compaction_start`: converts the open waiting node into a compaction node, or creates one. The node carries `streaming: true`, `startedAt`, and `tokensBefore` from the payload. Sets `compactionKey`.
  - `compaction_delta`: overwrites the open compaction node's `text` with the payload text. Creates the node from scratch when no compaction node exists.
  - `compaction_end`: sets the node's `text` to the payload `summary`, `streaming: false`, `endedAt`, and fills `tokensBefore`, `tokensAfter`, and `entryId`. Clears `compactionKey`.
- A `compaction_start` while a compaction node is still streaming settles the older node first, mirroring `message_start`.
- `message_start` and `session_end` also settle a streaming compaction node, through a `settleStreamingCompaction` helper that mirrors `settleStreamingThinking`.
- `hasTurnParts`: after-exists true. after-kind function. It treats `'compaction'` as a turn part.
- `compactReplayEvents`: after-exists true. after-kind function. The `REPLAY_STREAMING` set gains `'compaction_delta'`, so replay keeps the first and last delta frame of each compaction stream like it does for `message_update`.
- `appendCompactedReplayEvent`: after-exists true. after-kind function. It compacts `compaction_delta` frames the same way.

**Per-target success expectations.**

- Folding start, delta, delta, end produces one compaction node whose text matches the end event's summary and whose token fields match the payload.
- A live fold and a replayed fold of the same event list produce byte-identical chat rows with identical `endedAt` values.
- A compaction card in the middle of the timeline does not disturb adjacent thinking bars, tool cards, or user bubbles.
- The trace fold behavior from batch 008 is unchanged: traces fold onto tool cards, and a trace with no running tool folds to nothing.
- A compaction card counts as a turn part, so the three-dot gap does not flash after it.
- The reset test passes with the new `compactionKey` field.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/workbench/session-store.test.ts` expect `passed`. The suite gains the compaction fold cases. The existing trace ring tests stay untouched.
- G02 (unit): `npx vitest run tests/workbench/replay-compact.test.ts` expect `passed`. The suite gains the first-and-last compaction delta cases.
- G03 (integration): `npx vitest run tests/workbench/session-fold.test.ts` expect `passed`. The suite pins the thinking interplay: waiting conversion, settle points, and late-frame behavior.
- G04 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

### S03 Compaction card UI and i18n parity (tier 3)

**Target symbols.**

- `components/workbench/chat/compaction-block.tsx` :: `CompactionBlock` (kind component, new).
- `components/workbench/chat/compaction-bar-state.ts` :: `compactionBarSummary` (kind function, new).
- `components/workbench/chat/compaction-bar-state.ts` :: `compactionBarPreview` (kind function, new).
- `components/workbench/chat/compaction-bar-state.ts` :: `useCompactionBar` (kind function, new).
- `components/workbench/chat/format.ts` :: `formatTokens` (kind function, new).
- `components/workbench/chat/action-cluster.tsx` :: `ActionCluster` (kind component, existing).
- `components/workbench/chat/chat-timeline.tsx` :: `rowsForRender` (kind function, existing).
- `lib/i18n/workbench.ts` :: `workbenchEn` (kind constant, existing).
- `lib/i18n/workbench.ts` :: `workbenchZh` (kind constant, existing).

**Before-state capture facts.**

- `ThinkingBlock` is the model the card mirrors: a brain icon from lucide (`thinking-block.tsx:9,60`), a summary label (`thinking-block.tsx:36-42`), a preview (`thinking-block.tsx:43`), a chevron toggle (`thinking-block.tsx:70-72`), and an expanded `<pre>` body (`thinking-block.tsx:74-78`). The collapse state lives in `thinking-bar-state.ts`: `thinkingBarSummary` at `:38-52`, `thinkingBarPreview` at `:63-70`, `useThinkingBar` at `:72-75`.
- The thinking bar renders through `action-cluster.tsx:36-46` and `chat-timeline.tsx:256-265`. `isActionBar` at `chat-timeline.tsx:55-57` gates grouping. `actionRunKey` at `chat-timeline.tsx:131-134` splits runs.
- The workbench copy map is NOT `lib/i18n/locales/*.json`. It is `lib/i18n/workbench.ts`: `workbenchEn.thinking` at `:159-163` and `workbenchZh.thinking` at `:459-463`, plus ten JSON overlays in `lib/i18n/workbench-locales/` that translate the thinking keys (each at its line 99). `pnpm check:i18n-keys` (`scripts/check-i18n-keys.mjs`) checks only the 12 app locale files under `lib/i18n/locales/`. The workbench parity gate is `tests/workbench/workbench-i18n.test.ts:58-107`, which resolves every `workbenchEn` key in all twelve supported locales and pins the interpolation variables.
- The thinking card button has `aria-expanded` and no `aria-label` (`thinking-block.tsx:53-57`). The accessible name is the summary text itself. The compaction card mirrors this, so no new aria key is needed.
- The card styles live under `wbStyles.thinking` in `components/workbench/chat/chat-styles.ts:123-130`. The compaction card reuses the same visual language, either through the shared `thinking` tokens or a small `compaction` block.

**Postcondition (per target symbol).**

- `CompactionBlock`: after-exists true. after-kind function. after-signature `(props: { text: string; streaming?: boolean; tokensBefore?: string; tokensAfter?: string; endedAt?: number; stackPosition?: ToolStackPosition; t?: WorkbenchTranslator }): React.JSX.Element | null`. React 19 removed the global `JSX` namespace, so the return type is `React.JSX.Element`, and the component returns null for empty text, same as `ThinkingBlock`. The token props are PRE-FORMATTED strings. The caller converts the node's numeric token counts through `formatTokens`. It renders the thinking-card shape: a lucide `Shrink` icon, a label, a preview on the collapsed row, a chevron toggle, and an expanded `<pre>` body. It is collapsed by default and only a click toggles it.
- `compactionBarSummary`: after-exists true. after-kind function. after-signature `(input: { streaming: boolean; before?: string; after?: string }, t?: WorkbenchTranslator): string`. It returns the running label while streaming, the token label when both formatted counts exist, and the plain done label otherwise.
- `compactionBarPreview`: after-exists true. after-kind function. after-signature `(text: string): string`. It reuses the thinking preview algorithm: the last nonempty line, capped at 200 characters.
- `useCompactionBar`: after-exists true. after-kind function. after-signature `(): { expanded: boolean; toggle: () => void }`. Same collapse contract as the thinking bar.
- `formatTokens`: after-exists true. after-kind function. after-signature `(tokens: number): string`. It renders `112K` for 112000, `24K` for 24000, `1.2M` for 1200000, and the raw number below 1000.
- `ActionCluster`: after-exists true. after-kind component. It renders `CompactionBlock` for compaction nodes in the mixed bar stack.
- `rowsForRender`: after-exists true. after-kind function. `isActionBar` and `ChatNodeView` handle `'compaction'`, and compaction nodes form their own run key.
- `workbenchEn`: after-exists true. after-kind constant. Gains `compaction: { active: 'Compacting context…', doneWithTokens: 'Compacted {{before}} → {{after}}', done: 'Compacted' }`.
- `workbenchZh`: after-exists true. after-kind constant. Gains the same three keys in Chinese, for example `active: '正在压缩上下文…'`, `doneWithTokens: '已压缩 {{before}} → {{after}}'`, `done: '已压缩'`.
- The ten overlay files under `lib/i18n/workbench-locales/` gain the three keys translated, with the exact interpolation variables `{{before}}` and `{{after}}`.

**Per-target success expectations.**

- The card label reads "Compacting context…" while streaming and "Compacted 112K → 24K" once settled with both token counts.
- The collapsed row shows the growing preview while streaming and the last summary line once done.
- Expanding shows the full summary text.
- Every one of the twelve supported locales resolves the three keys to a real nonempty sentence with the same interpolation variables.
- `pnpm check:i18n-keys` still passes. No key is added to `lib/i18n/locales/*.json`.
- The timeline groups a compaction card as its own action row and never merges it into an adjacent thinking bar.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/workbench/workbench-i18n.test.ts` expect `passed`. The twelve-locale contract covers the new keys, including interpolations.
- G02 (integration): `npx vitest run tests/workbench/chat-timeline.test.ts` expect `passed`. New cases assert compaction rows group and split correctly beside thinking and tool runs.
- G03 (guard): `pnpm check:i18n-keys` expect `i18n key alignment check passed`. This gate proves no app locale file drifted.
- G04 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

## Implementation Decisions

- **The event design is three structured lifecycle events, not a trace prefix.** The runner's `emit` is the durable stream. `trace` folds onto tool cards and disappears without one. A prefix reuse would carry no token metadata and would fight the existing trace ring. Named lifecycle events flow to the browser automatically because `WORKBENCH_EVENT_TYPES` is derived from `HOST_AGENT_LIFECYCLE`. The names carry no vendor term.
- **`compaction_end` carries the authoritative summary text.** The workbench fold is a pure function of the durable event log. It never reads `agent_session_entries`. The entry row already stores the summary, but the fold cannot see it. So the end event carries entryId, tokensBefore, tokensAfter, and the full summary. Replay rebuilds the card from start plus end alone.
- **`compaction_delta` carries the full accumulated text, like `message_update`.** The fold overwrites the node text each frame, which is the exact thinking path. The deltas are throttled at 150 ms and pruned to first and last on `compaction_end`, mirroring `pruneMessageUpdates`. This keeps durable rows slim while the live preview grows.
- **The summarizer streams through `streamLLM`.** `streamLLM` replaces `callLLM` in the default summarizer, sourced through the same dynamic import seam. The function keeps the single stage `maic-agent-compaction` and no fallback. The lint guard and the neutrality guard both stay green because the import path is `@/lib/ai/llm`.
- **The runtime stays pure. The runner owns emission policy.** `makeCompactionRuntime` gains one injected sink, `emitEvent`, and emits raw card events in order. The runner maps them to durable lifecycle frames, applies the 150 ms throttle, and prunes the deltas on the end frame. The runtime's `InMemorySessionRepo` seam keeps every gate hermetic.
- **The prune lives in the storage package.** `pruneCompactionDeltas` mirrors `pruneMessageUpdates` in SQL shape. This is an additive interface member. The storage package publishes, so the same PR bumps `@openmaic/storage` and rebuilds its `dist/`. The app consumes the built package.
- **The fold reuses the waiting-node conversion.** A compaction runs before the next LLM call, so a waiting node is normally open. `compaction_start` converts it, exactly like the first thinking frame does. No waiting node means the fold creates one.
- **Settle fallbacks mirror thinking.** A crashed summarizer leaves no end event. `message_start` and `session_end` settle the streaming card so a killed run does not paint a forever-spinning bar. This is the same doctrine `settleStreamingThinking` applies.
- **The card is a new node kind, not a tool card.** A tool card carries a tool call contract and trace rings. Compaction is none of those. A separate `compaction` kind keeps the timeline honest and the fold simple. The task's "not attached to a tool card" is satisfied by construction.
- **The icon is lucide `Shrink`.** Candidates were `Shrink`, `Minimize2`, `Archive`, `Layers`, `Scissors`, and `Magnet`. `Shrink` reads as contraction and is the least likely to be mistaken for a window control or a storage concept. It also differs clearly from the thinking bar's `Brain`.
- **The workbench copy is the twelve-locale map, not the app locale JSONs.** The requirement assumed keys live in `lib/i18n/locales/en-US.json`. Research corrects this: workbench product copy lives in `lib/i18n/workbench.ts` and the ten overlays, and the parity gate is `tests/workbench/workbench-i18n.test.ts`. `pnpm check:i18n-keys` stays green untouched and is kept as a guard.
- **The frozen signatures carry `// prettier-ignore`.** Batch 009's lesson applies: the diff gate compares stored signatures against a whitespace-preserving recapture. A one-line signature that crosses the 100-column wrap carries the marker.

## Testing Decisions

- Test homes: `tests/agent-runtime/compaction-summary.test.ts` is rewritten for the streaming summarizer, mocking `streamLLM` with a fake `fullStream`. `tests/agent-runtime/compaction-runtime.test.ts` gains emitEvent ordering cases against the in-memory session seam. `tests/workbench/session-store.test.ts` gains the three compaction fold cases. `tests/workbench/replay-compact.test.ts` gains the first-and-last delta cases. `tests/workbench/chat-timeline.test.ts` gains the grouping cases. `tests/workbench/workbench-i18n.test.ts` is the parity gate for the new keys.
- `tests/workbench/session-store.test.ts` keeps the batch 008 trace ring tests untouched. The trace behavior does not change in this batch.
- `tests/workbench/draft-conversation-reset.test.ts` and `tests/agent-runtime/runner-event-order.test.ts` are extension points, not gate files to rewrite. The reset test adopts `compactionKey` automatically because it walks the factory's own keys. The runner order test's store mock gains `pruneCompactionDeltas` so the type contract compiles.
- The runner wiring is thin glue: `emit` mapping, throttle, and the prune call. Its guarantees are pinned at the runtime level: the emitEvent ordering tests in `compaction-runtime.test.ts` and the default-off no-frame assertion in `runner-event-order.test.ts`. A full pi harness that drives a real compaction through `runSession` is out of scope. The live tandem run is that check.
- Zero paid gates. Every gate mocks the model call and touches no database. The PG storage contract suites are not gates for this batch.
- Gate oracle doctrine follows batches 009 and 010: expect strings are literal substrings of stdout. Silent success commands echo a literal marker. `pnpm check:i18n-keys` prints its own pass line, so it is its own oracle.
- The `snapshotEventDataForLog` slimming does not special-case the new events. `compaction_delta` rows pass through and are pruned, so `tests/agent-runtime/event-log-slim.test.ts` needs no change and is kept as a guard.

## Out of Scope

- Replacing the batch 009 trace line. The diagnostic trace stays. The card is a new surface beside it.
- Reading the compaction entry from `agent_session_entries` in the fold. The fold stays a pure function of the event log.
- Adding the compaction card to tool-card tool groups, skill-load cards, or any tool presentation path.
- Changing the trigger policy, the settings floors, the entry writer, or `entry-tree-storage`.
- Any DB migration. The events table carries a plain text `type` column.
- Editing other specs or touching the tandem session, the database, or `.env` files.
- App locale JSONs under `lib/i18n/locales/`. The copy map is `workbench.ts` plus the overlays.
- Enabling compaction by default. The batch 009 flag behavior is unchanged.

## Open Questions

- **The `pruneCompactionDeltas` SQL shares its shape with `pruneMessageUpdates` but stays a separate method.** A shared helper would reduce duplication but would churn the storage surface harder. The implementer may extract a private helper inside `pg.ts` without changing the public interface.
- **The settled label rounds token counts with `formatTokens`.** `Compacted 112K → 24K` uses rounded thousands. The requirement's example uses the same shape. No exact rounding rule was fixed beyond thousands and millions.
- **A compaction that fires twice in one run produces two cards.** Each start event creates its own node keyed by its event id. The task wants one card per compaction, so this is intended.
- **The overlay equality test covers only `tool.*` keys.** `workbench-i18n.test.ts:80-106` holds the ten overlay files strictly to the base tool keys. The three compaction keys fall under the softer merged-resource check, which tolerates a missing overlay translation by falling back to the base sentence. The spec requires real translations in all ten overlays, and the interpolations check catches wrong variables, but nothing forces a translation over a fallback.

## Further Notes

- **Tandem acceptance criterion (meta-level, not a ledger gate).** After implementation, session `13dd023b-322f-4631-8a7d-d46fc26011e2` resumes. The first real compaction, expected around page 23 with a context of about 111.6K tokens crossing the trigger, must render the card in the workbench chat. The card streams while the summarizer runs, settles to a "Compacted" token label, expands to the full summary, and survives a refresh. This is a program-level acceptance criterion for the orchestrator to watch. Every ledger gate stays hermetic.
- The storage package version bump is mandatory with the `pruneCompactionDeltas` change. The implementer rebuilds the package (`pnpm --filter @openmaic/storage build`) so the app consumes the new `dist/`.
- Cross batch: 011 builds on 009's runtime and 008's durable trace channel. Neither batch depends on 011.
- The verifier note from batch 009 applies: gates stay neutral-cwd friendly. The bun compiled rivr loads `.env.local` from its startup cwd, so gates that must stay clean run from a neutral cwd.
## Research Update (Stage 4)

Delivered evidence: implementation commit `8e866fde` (S01-S03, all 13 gates), contract-shape fix commit `dd15b43b` (named-parameter signatures). Verification round 1: all three slices verified with fresh gates. Full suite at mark time: 7466 passed, 1 failed, 31 skipped. The single failure, `tests/agent-runtime/runner-skills-registration.test.ts`, was proven pre-existing by two independent clean-checkout stashes of main.

Deviations from the drafted spec, all resolved in favor of the verified truth:

- The storage interface is `AgentSessionEventLog` (`packages/@openmaic/storage/src/agent-session/types.ts:376`). The draft named it `AgentSessionEventStore`, which does not exist. The spec text is corrected.
- `CompactionBlock` takes pre-formatted string token labels, not numbers. The caller converts numbers through `formatTokens`. The ledger postcondition carries this contract.
- React 19 removed the global `JSX` namespace. The component's real return type is `React.JSX.Element | null`, matching `ThinkingBlock`'s empty-text behavior. The draft signature `JSX.Element` was not expressible.
- The first implementation destructured parameters at the call position, which deviated from the recorded named-parameter signatures. Commit `dd15b43b` restored the named form. The diff now matches for every S03 symbol except the two recorded artifacts below.
- Ledger record artifacts, kept as-is because postconditions freeze at research: the `CompactionBlock` postcondition still reads `JSX.Element`, and the `ActionCluster` postcondition carries an empty signature while the real symbol is a multi-line destructured component that this batch did not change in shape. Neither affects the code contract.

Storage package: `@openmaic/storage` 0.28.1 to 0.28.2 with `pruneCompactionDeltas`, rebuilt `dist/` consumed by the app.

Pending at close time: the meta-level live acceptance. Session `13dd023b-322f-4631-8a7d-d46fc26011e2` resumes after this batch; the first real compaction near page 23 must render the card live, settle to the token label, expand to the full summary, and survive a refresh. Certification of this batch is held until that observation completes.
