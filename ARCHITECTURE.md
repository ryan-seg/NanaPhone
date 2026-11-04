# NanaPhone architecture (v2.9.4)

Static site (GitHub Pages) + Firebase Realtime DB + Daily.co video + Google Apps Script (Telegram gateway).
One `index.html`, loaded as ES modules. Same code runs as **Nana's tablet** (`?role=nana`) or a **family phone** (`?role=family&id=<member>`). `&test=1` uses a separate sandbox DB node.

## Modules (load order = index.html order)
| File | Job | Touch it for |
|---|---|---|
| `nana-core.js` | Auth (key hash), config, family list, Firebase `refs`, shared `settings` / `state` / `hooks`, `askNana()`, `esc()`, tab switching | anything shared |
| `nana-settings.js` | Settings UI + `updateSetting`, brightness/night mode, battery voice, admin PIN, hide-me & call-hours | settings, dimming, night |
| `nana-chat.js` | Family chat feed, senior keyboard, read receipts | chat |
| `nana-video.js` | Video queue + player, resume position, family remote control | video |
| `nana-popups.js` | Yes/No pop-ups on Nana's screen, scheduled prompts | prompts |
| `nana-telemetry.js` | Presence/battery heartbeat, family status card, today's calls banner | "is Nana ok?" card |
| `app.js` | Calls (Daily room, ringing, Telegram rings), radio, contact grid, missed calls, remote reload | calls, radio |

Rule: modules never import each other except via `nana-core.js`. They talk through `NanaCore.hooks.*` (functions a module registers) and `window.*` functions (called by `onclick` in index.html).

## Shared objects (nana-core.js)
- `settings` – defaults, overwritten by `portals/<node>/settings`. Change with `window.updateSetting(key, value)`.
- `state` – live snapshots: `callSnap`, `presenceSnap`, `bulletinSnap`, `streamData`, `currentState` (call status), etc.
- `hooks` – cross-module callbacks (`pauseVideo`, `resumeVideo`, `broadcastScreen`, `renderContacts`, `onSettingsChanged[]` …).
- `askNana(type, question, askedBy, extra)` – the only way to show a Yes/No pop-up.

## Firebase paths (`portals/<node>/…`)
`callState` · `callHistory` · `presence` · `bulletin` · `settings` · `missedCalls` · `connectedMembers` · `hiddenContacts` · `callSchedules` · `entertainment` (radio on/off) · `videoStream` (queue, currentIndex, state, savedTimes, viewCounts) · `quickQuestion` · `questionHistory` · `commands/reloadAt` · `callBeat` (heartbeat while in a call) · `callDiag/<nana|member>` (last 30 call events per device, for debugging)

## Call state machine (`callState.status`)
`idle` → `calling_family` (Nana dials; Telegram rings family) → `connected` (family taps Answer link)
`idle` → `ringing_nana` (family dials) → `connected` (Nana answers)
Any state → `idle` on hang-up / timeout. Both sides join Daily room `CONFIG.dailyRoomUrl` only when `connected`.
Safeguards: family pick-up is a transaction (must still be `calling_family`); call auto-ends if nobody else joins within 90 s; family ring times out after ring duration + 15 s; remote video never starts while `currentState !== 'idle'`.

## Call reliability rules (app.js)
- Join retries 3x; a fatal Daily error after joining triggers up to 2 automatic rejoins, then a clean hang-up.
- Hang-up order: free camera/mic first (`teardownCallObject`, bounded by timeouts), Firebase `idle` write second and never awaited.
- A `connected` call is never overwritten by a new ring; it counts as dead only if `callBeat`/timestamp is >2 min old.
- Audio: Nana's mic DSP falls back to the plain mic if the AudioContext can't run; blocked autoplay shows "Touch the screen to hear" and retries on touch.
- `online` event rejoins a call; `pagehide` leaves the room (no ghost participants).
- Audio path (family phones): the Web Audio booster is the only audible path while running (element muted); iPhones and boost <= 100% use plain element playback. Set `familyVoiceBoostPct` to 100 to switch the booster off.
- Nana's tablet sends modest video (640x480, ~20 fps, 'bandwidth-optimized'); her camera is switched off while Daily reports a 'bad' network and back on at 'good', so her voice keeps priority.
- To debug a bad call: open Firebase `callDiag/` and read both devices' event lists.

## Pop-up types (`quickQuestion.type`) and who handles the answer
`family_question` (replies to chat + Telegram) · `leave_video_prompt` · `restart_video_prompt` · `next_video_prompt` · `unread_chat_prompt` · `idle_radio_prompt` · `idle_video_prompt`. Answers handled in `window.submitNanaQuestionAnswer` (nana-popups.js). Pop-ups are held back during calls and shown when the call ends (`window.refreshNanaQuestionPopup`).

## Conventions
- Anything written to `innerHTML` that comes from the DB must go through `esc()`.
- Prefer `update()` with path keys over `set()` on shared nodes (avoids overwriting other devices' writes).
- Cache-busting: bump `APP_VERSION` (core), `__NANA_PAGE_VERSION` + `?v=` in index.html, and the `--nana-styles-version` var in styles.css **together**; the footer shows a warning if they differ.

## Known open items
- daily-js is loaded unpinned from unpkg – pin a tested version.
- Presence times use the tablet clock (drift can show false "offline").
