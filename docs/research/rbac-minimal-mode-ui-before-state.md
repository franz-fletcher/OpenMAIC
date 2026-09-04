# RBAC + Minimal Mode — UI Before-State Baseline

Captured: 2026-09-04 · work_id: `feature:rbac-minimal-mode`
Purpose: authenticated-free snapshot of every client surface the upcoming
auth/RBAC batches will change. Later previews and after-states diff against
this report + the PNGs under `docs/research/ui-before/`.

Capture tool: Safari via `/usr/bin/safaridriver --mcp` (MCP mode, newline-
delimited JSON-RPC 2.0 over stdio — the same mechanism as
`scripts/check-safari-console-clean.js`). **Capture state: CAPTURED**
(2026-09-04). MCP mode does NOT need `AllowRemoteAutomation`/WebDriver
prefs — the earlier "Safari Remote Automation not enabled" blockers applied
only to the WebDriver protocol path and were a false trail. All 17 checklist
surfaces captured; PNGs in `docs/research/ui-before/`; console baselines and
live DOM observations in the "Live capture results" section below.

---

## 1. Server state

- Dev server responds `HTTP/1.1 200 OK` at http://localhost:3000 (verified
  via `curl -sI`, 2026-09-04 00:10Z). Started by the user before this run;
  remains running. Header shows `X-Powered-By: Next.js`, `Cache-Control:
  no-store`.
- Git: branch `main`, 20 commits ahead of origin, working tree clean apart
  from untracked `docs/research/rbac-minimal-mode-decision-round-1.md`.

## 2. Environment flags that change what anonymous visitors see

| Var | Value | Effect |
|---|---|---|
| `ACCESS_CODE` | unset | No site-lock HMAC modal; anonymous visitors hit the app directly (middleware.ts:60-86 gate inert) |
| `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED` | `true` | `/workspace` + `/workbench` are **real pages, not 404**; ProBadge renders on home hero |
| `NEXT_PUBLIC_MAIC_EDITOR_ENABLED` | unset | MAIC editor surfaces stay hidden |
| `MINIMAL_MODE` / `NEXT_PUBLIC_MINIMAL_MODE` | unset | Current behavior: everything available to anonymous |

## 3. Capture checklist (PNG evidence, `docs/research/ui-before/`)

Viewport: 1440 × 900. Dev server: http://localhost:3000.

| # | File | Surface | Status |
|---|---|---|---|
| 01 | `01-home-anon.png` | Home `/` anonymous, full page | CAPTURED |
| 02 | `02-settings-token-plan.png` | Settings → Token Plan | CAPTURED |
| 03 | `02-settings-providers.png` | Settings → LLM | CAPTURED |
| 04 | `02-settings-image.png` | Settings → Image Generation | CAPTURED |
| 05 | `02-settings-video.png` | Settings → Video Generation | CAPTURED |
| 06 | `02-settings-tts.png` | Settings → TTS | CAPTURED |
| 07 | `02-settings-asr.png` | Settings → ASR | CAPTURED |
| 08 | `02-settings-pdf.png` | Settings → Document Parsing | CAPTURED |
| 09 | `02-settings-web-search.png` | Settings → Web Search | CAPTURED |
| 10 | `02-settings-skills.png` | Settings → Skills | CAPTURED |
| 11 | `02-settings-general.png` | Settings → System | CAPTURED |
| 12 | `02-settings-agents.png` | **No agents nav item exists — see §6 note** | N/A (confirmed live) |
| 13 | `03-classroom-empty.png` | Classroom/course surface — empty state (fresh anonymous profile) OR opened course header if any exist | CAPTURED (empty state: "No courses yet") |
| 14 | `04-workbench.png` | `/workbench` (real page — flag on) | CAPTURED — exact `/workbench` 404s live (no `app/workbench/page.tsx`); real page at `/workbench/new` → **`04-workbench-new.png`** |
| 15 | `04-workspace.png` | `/workspace` Pro workbench home (ProBadge rail) | CAPTURED |
| 16 | `04-classroom-nonexistent.png` | `/classroom/<nonexistent-uuid>` | CAPTURED |
| 17 | `04-unknown-404.png` | Deliberate 404 (`/definitely-not-a-route`) | CAPTURED |

Console baseline (error filter on home, and on each captured surface) →
appendix A.

## 4. Home page `/` — static analysis (app/page.tsx)

- **Hero** (app/page.tsx:826-964): logo + slogan `t('home.slogan')` +
  unified composer. ProBadge at 848-855 (visible because workbench flag on).
- **Composer top row** (879-885): `<GreetingBar />` (881) left,
  `<AgentBar />` (883) right.
  - **GreetingBar** (app/page.tsx:1362-1638) = collapsed profile pill
    (avatar + `t('home.greetingWithName')` + chevron) that expands to a
    local profile panel (name/avatar/bio). Uses `useUserProfileStore`
    (localStorage-persisted, **no server identity**). This pill is the
    natural future seat for a real account menu / login button — nothing
    else on the home page represents identity.
  - **AgentBar** (components/agent/agent-bar.tsx) = agent role picker
    (teacher/assist/student), also local-only.
- **Composer toolbar** (898-913): `GenerationToolbar` with
  `onSettingsOpen(section)` → opens `SettingsDialog` from the toolbar's
  **advanced settings** affordance (`toolbar.advancedSettings`,
  components/generation/media-popover.tsx:360-364). Settings gear on the
  home page is NOT a top-right header icon; it lives in this toolbar
  popover. Top-right of the home page itself has no global controls.
- **Recent classrooms** (1029+): collapsible library with search /
  new-folder / import actions, `t('classroom.recentClassrooms')` header,
  classroom count badge. Empty state for a fresh anonymous profile.
- **SettingsDialog mount**: app/page.tsx:805-806.

### Copy audit — i18n vs hardcoded

- Homepage copy is otherwise i18n-keyed (`home.*`, `upload.*`,
  `toolbar.*`, `classroom.*`, `profile.*`, `settings.*`).
- **CONFIRMED hardcoded Chinese** at app/page.tsx:988-1009 (vocational-test
  toggle): `测试功能` (989), `职教任务` (991), tooltip
  `从当前输入框提交职教实操训练测试` (1008). Surrounding strings are all
  `t()` keys. This region renders only when `showVocationalTestUi`
  (task-specific; note for the i18n-gate cleanup, not auth).

## 5. Settings modal — section inventory & secret exposure

Dialog: `components/settings/index.tsx` — `SettingsDialog` (204-1207).
Shell: `DialogContent h-[85vh]` (736), `sr-only` title/description
(737-738), three columns: sidebar nav (741-871) → 5px resize handle
(874-879) → provider list (882-898, only for provider sections).
Resizable widths: sidebar default **192px**, clamp [120, 360] (276-326);
provider-list column default **192px** same clamp.

Sidebar nav order and labels (all i18n keys — no hardcoded labels):

| # | Section | Nav icon | i18n key | en-US value |
|---|---|---|---|---|
| 1 | `token-plan` | CreditCard | `settings.tokenPlan.nav` | Token Plan |
| 2 | `providers` | Box | `settings.providers` | LLM |
| 3 | `image` | ImageIcon | `settings.imageSettings` | Image Generation |
| 4 | `video` | Film | `settings.videoSettings` | Video Generation |
| 5 | `tts` | Volume2 | `settings.ttsSettings` | Text-to-Speech |
| 6 | `asr` | Mic | `settings.asrSettings` | Speech Recognition |
| 7 | `pdf` | FileText | `settings.documentParsingSettings` | Document Parsing |
| 8 | `web-search` | Search | `settings.webSearchSettings` | Web Search |
| 9 | `skills` | Sparkles | `settings.skills.nav` | Skills |
| 10 | `general` | Settings | `settings.systemSettings` | System |

Provider sections also show a middle provider-list column with its own
resize handle (882-898).

**Secret (API-key) exposure per section — candidates for admin-only gating:**

| Section | Exposes secret? | Evidence (file:line) |
|---|---|---|
| `token-plan` | **YES** — single global API key | `settings.tokenPlan.apiKey` ("API Key") in token-plan-settings.tsx; auto-configures all modalities |
| `providers` (LLM) | **YES** — per-provider apiKey | provider-config-panel.tsx `handleApiKeyChange` 106-109; apiKey state flows from index.tsx 336-347 |
| `image` | **YES** | image-settings.tsx `handleApiKeyChange` 101-103 |
| `video` | **YES** | video-settings.tsx `handleApiKeyChange` 63-65 |
| `tts` | **YES** — apiKey + cloned voice profiles + reference recordings | tts-settings.tsx 152-155 (Doubao compound key), 759-830 (recording), 1187-1502 (Qwen clone manager) |
| `asr` | **YES** | asr-settings.tsx 241-244; note at 225: "API Key & Base URL — hidden for managed providers, which are admin-owned" (existing server-provider precedent) |
| `pdf` | **YES** — incl. Aliyun AccessKey ID+Secret | pdf-settings.tsx 134-136, 168-171, 302-304 |
| `web-search` | **YES** | web-search-settings.tsx 98-101 |
| `skills` | no | skill-settings.tsx (upload/download/list only) — but account-scoped, likely admin/owner-only later |
| `general` | no | general-settings.tsx (persistence/clear-cache only) |
| `agents` | n/a | **No nav item and no render path** — see §6 note |

Capability-matrix overlap (decision doc Q3): "Settings modal (providers,
keys)" is admin-only; the sections above are exactly the leak surface an
anonymous user currently has.

## 6. Surprises / notes

1. **No `agents` section in the UI.** `SettingsSection` type
   (lib/types/settings.ts:3-14) lists `'agents'`, and
   `components/settings/agent-settings.tsx` (unused `AgentSettings`
   component) exists, but the sidebar has no agents nav item and nothing
   renders `activeSection === 'agents'`. Dead surface — either wire it up
   with the role management UI later or drop the union member.
2. **`/workbench` is real, not 404** (`NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=true`).
   Pro entry actually routes to `/workspace` (app/page.tsx:159-166,
   workspaceResumeHref). Both pages exist under `app/workbench` and
   `app/workspace`.
3. **No ACCESS_CODE modal** — env var unset; anonymous visitors go straight
   to the authenticated-free home. (If ACCESS_CODE were set, middleware
   would show the site-lock screen.)
4. **Existing server-provider precedent for hiding keys**: asr-settings
   hides keys for server-managed ("admin-owned") providers — the pattern
   RBAC gating can reuse (components/settings/asr-settings.tsx:225).

## 7. Header / account-menu insertion analysis (stage & classroom chrome)

Top-right chrome that auth controls will need to live beside/replace:

- **components/stage/header-controls.tsx** owns the right-side cluster:
  - Global capsule (139-211): LanguageSwitcher (151), theme dropdown
    (155-201), **Settings gear** (204-210).
  - Pro Switch (219-261), export/share menu (267-391) sitting to the right
    of the capsule.
  - `SettingsDialog` mounted at 393.
- **Header** (components/header.tsx:34-103) hosts `HeaderControls` at
  92-99; props `hideGlobalControls` / `hideCourseActions` already allow an
  embedded-workbench classroom to drop the whole cluster (29-31, 116-130),
  so the same props are the natural seam for "hide auth-less controls when
  anonymous".
- **Export/share "stub"**: header-controls.tsx:111 —
  `const exportLabel = canExport ? t('export.pptx') : t('share.notReady');`
  — the downstream share-menu stub the prior audit flagged; it directly
  controls the disabled Export button title/aria (270-282) and the grouped
  menu items (296-372). Auth batches can reuse the same `disabled` pattern
  for guest role.
- **Account-menu seat candidates** (nothing occupies these today):
  1. Home: GreetingBar pill (app/page.tsx:1437-1477) — the only
     identity-like affordance (avatar + nickname, local-only).
  2. Stage/classroom: right of the global capsule in HeaderControls
     (139-211) — currently ends at the gear.
  3. Pro workbench: WorkspaceRail (components/workbench/workspace/
     WorkspaceRail.tsx) — ProBadge lives there today.

## Appendix A — console baseline (error filter)

Live captures (2026-09-04, Safari via `safaridriver --mcp`, `level_filter=[error]`, buffer cleared after each surface). "HMR suspension" entries are Safari tab-suspension artifacts of the Next dev HMR websocket, not app errors; the 404 resource entries occur on surfaces that genuinely 404.

| Surface | Console error entries |
|---|---|
| Home `/` | (none) — clean |
| Settings dialog (each of the 10 sections) | (none) — clean across all sections |
| Classroom empty state (home library) | (none) — clean |
| `/workbench` (exact) | `Failed to load resource: 404 (Not Found)`; HMR websocket suspension |
| `/workbench/new` | (none) — clean |
| `/workspace` | HMR websocket suspension only |
| `/classroom/<nonexistent-uuid>` | HMR websocket suspension; `404 (Not Found)` ×3 (missing course resources) |
| `/definitely-not-a-route` | `404 (Not Found)`; HMR websocket suspension |

No warnings (`level_filter=[warn]`) on any surface.---

## 8. Live capture results (2026-09-04, Safari via `safaridriver --mcp`)

Mechanism: `/usr/bin/safaridriver --mcp`, newline-delimited JSON-RPC 2.0 over
stdio (`initialize` → `notifications/initialized` → `tools/*`), identical to
`scripts/check-safari-console-clean.js`. MCP mode needs no
`AllowRemoteAutomation` — the earlier blocked verdict was a WebDriver-only
artifact. Driver: `/tmp/rbac-safari-capture/capture.mjs` (throwaway, not in
repo). Cleanup confirmed: `close_tab` + SIGTERM; no stray `safaridriver`
process from this run.

### 8.1 Tool inventory exposed by this safaridriver build (17 tools)

`browser_console_messages` (level_filter/clear/limit/tab_handle),
`browser_dialogs` (list/respond/dismiss), `close_tab`, `create_tab`,
`evaluate_javascript` (`$uid(N)` support), `get_network_request`,
`get_page_content` (textTree/markdown/json/html; region; nodeIds
none|editable|interactive|allContainers; savePath), `list_network_requests`,
`list_tabs`, `navigate_to_url`, `page_info`,
`page_interactions` (click/type/keyPress/scroll/selectText/selectMenuItem/
hover/highlightText; node-UID or find-in-page text), `screenshot` (returns a
**file path, never base64**; full_page; savePath), `set_emulated_media`,
`set_viewport_size`, `switch_tab`, `wait_for_navigation`.

### 8.2 Capture notes

- Viewport: `set_viewport_size` must be called **after** `create_tab`;
  applies to the tab's browsing context. Driver clamps CSS viewport height
  900 → 796 (`contentSize=[1440×796]`); PNGs are 2× device pixels
  (2880×1592). Width 1440 exact.
- Opening Settings on home requires **two** clicks: (1) the composer
  `SlidersHorizontal` icon button (`svg.lucide-sliders-horizontal`), which
  opens the media popover; (2) the popover footer
  `toolbar.advancedSettings` = "Advanced Settings", which calls
  `onSettingsOpen(activeTab)`. Find-in-page text clicks could not reach the
  hidden popover content; UID/JS-driven clicks worked. The dialog opens on
  the last-active media tab (this capture opened on Video Generation) —
  that is why section 02-settings-video.png contains the provider list
  column (Seedance/Kling/Veo/MiniMax/Grok Video/HappyHorse **`Server`**
  badge — the existing server-managed/hidden-key precedent at
  asr-settings.tsx:225 is exercised by HappyHorse here too).
- All 10 settings nav clicks used real dialog-tree UIDs (1231–1240).
- Screenshot capture for every settings section: console clean.

### 8.3 ACCESS_CODE modal — confirmed ABSENT live

`ACCESS_CODE` unset: home `/` loaded directly with the full app (header,
hero, composer, ProBadge), no site-lock/HMAC modal, 0 console errors.
Matches static analysis (§2, §6.3).

### 8.4 Console baseline (error filter) — see Appendix A

All surfaces clean except the genuinely-404 surfaces and HMR websocket
suspension artifacts (Safari tab suspension, not app errors):
- Home `/`, all settings sections, classroom empty state, `/workbench/new`,
  `/workspace`: **clean** (errors = 0, warns = 0).
- `/workbench` (exact): one 404 resource + HMR suspension (page is Next 404).
- `/classroom/<nonexistent-uuid>`: HMR suspension + 3× 404 resource.
- `/definitely-not-a-route`: one 404 resource + HMR suspension.

### 8.5 Live DOM: elements right of the recent-classrooms header

Live textTree (home `/`, uid=NNN interactive tree):

```
button uid=858            ← collapsible header 'Recent' + count '0'
button uid=859 label='Search courses'
button uid=860 (class='group/import items-center rounded-full')  ← import action
button uid=861 title='New folder' label='New folder'
'No courses yet — create one above, or import a course.'  ← empty state
```

So the seat "right of the recent-classrooms header" (the natural login/
account-menu insertion point in the library row) is currently occupied by
exactly three controls: **Search courses (859), import (860), New folder
(861)**, followed by the empty-state text. Any auth control inserted into
that header row lands beside those buttons; nothing else sits in that row
for a fresh anonymous profile.

### 8.6 Live DOM: settings gear neighborhood (stage/header chrome)

Global capsule top-right (uid order as rendered, home page):
`EN` language switcher (839) → theme icon button (840,
`rounded-full text-gray-400…`) → **settings gear icon button (841)** —
the gear is the last button of the capsule; the capsule ends there.
On the home page there is NO header gear at all; the settings entry point
is the composer-toolbar media popover footer (see §8.2). The
stage/classroom chrome (`components/stage/header-controls.tsx`, Pro Switch +
export/share menu right of the capsule) mounts the same `SettingsDialog`
(header-controls.tsx:393) — that is the "gear neighborhood" an account
menu would join on stage surfaces.

### 8.7 Live DOM: SettingsDialog sidebar (open dialog)

`overlay role=dialog labelledby=Settings describedby='Configure
application settings'`; sidebar order = exactly the 10 documented nav
buttons (uids 1231–1240): Token Plan, LLM, Image Generation, Video
Generation, Text-to-Speech, Speech Recognition, Document Parsing, Web
Search, Skills, System. **No "Agents" entry anywhere in the dialog tree
(regex `/agents/i` negative) — §6.1 dead-surface finding confirmed live.**
Footer buttons: `Close` (1261), `Save` (1262).