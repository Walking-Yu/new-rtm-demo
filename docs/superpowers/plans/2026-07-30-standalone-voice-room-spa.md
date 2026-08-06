# Standalone Voice Room SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained, customer-copyable voice-room SPA with two real RTM/RTC clients, complete seat/social/governance workflows, and root startup on port 8080.

**Architecture:** `demos/voice-room/` is an independent Vite application with pure domain transitions, SDK-independent RTM/RTC ports, Agora adapters, and one reusable endpoint runtime rendered twice by a demo shell. Existing scenario-lab source remains untouched; root scripts delegate only to the standalone voice-room app.

**Tech Stack:** React, TypeScript, Vite, React Router, `agora-rtm@2.2.4`, `agora-rtc-sdk-ng@latest`, Lucide React, Vitest, Testing Library, Playwright, CSS.

---

## Repository Safety

- The repository is not initialized as Git. Do not initialize Git or run add/commit/push commands.
- Do not delete, move, or rename the existing root `src/`, `e2e/`, or scenario catalog.
- Browser tests run headlessly.
- The existing root app becomes a retained legacy source tree; only commands and documentation change to point at `demos/voice-room/`.

## File Map

### Independent demo

- `demos/voice-room/package.json`: independent scripts and dependencies.
- `demos/voice-room/package-lock.json`: reproducible standalone install.
- `demos/voice-room/index.html`, `tsconfig*.json`, `vite.config.ts`, `playwright.config.ts`: build and test configuration.
- `demos/voice-room/start-demo.sh`: standalone port-8080 launcher.
- `demos/voice-room/README.md`: copy/run, Token, headphones, workflow, and production-boundary documentation.
- `demos/voice-room/src/domain/types.ts`: room snapshot, endpoint state, command, and event types.
- `demos/voice-room/src/domain/transitions.ts`: pure snapshot transitions and invariants.
- `demos/voice-room/src/domain/protocol.ts`: validated RTM envelope and deduplication.
- `demos/voice-room/src/runtime/ports/RtmPort.ts`: application RTM contract.
- `demos/voice-room/src/runtime/ports/RtcPort.ts`: application RTC audio contract.
- `demos/voice-room/src/runtime/agora/AgoraRtmAdapter.ts`: only `agora-rtm` import.
- `demos/voice-room/src/runtime/agora/AgoraRtcAdapter.ts`: only `agora-rtc-sdk-ng` import.
- `demos/voice-room/src/runtime/RoomStateRepository.ts`: Lock-guarded Storage snapshot access.
- `demos/voice-room/src/runtime/VoiceRoomClient.ts`: one endpoint lifecycle and business command orchestration.
- `demos/voice-room/src/app/App.tsx`: setup and room routes.
- `demos/voice-room/src/app/SetupPage.tsx`: manual two-endpoint credentials.
- `demos/voice-room/src/app/RoomPage.tsx`: dual-client composition and mobile endpoint tabs.
- `demos/voice-room/src/components/VoiceRoomClientView.tsx`: reusable endpoint UI.
- `demos/voice-room/src/components/SeatGrid.tsx`: eight stable seats.
- `demos/voice-room/src/components/RequestQueue.tsx`: queue and invitation UI.
- `demos/voice-room/src/components/InteractionPanel.tsx`: chat, emojis, gifts, announcement.
- `demos/voice-room/src/components/EventTimeline.tsx`: endpoint operation log.
- `demos/voice-room/src/components/HeadphonesWarning.tsx`: mandatory playback warning.
- `demos/voice-room/src/styles.css`: responsive operational UI.
- `demos/voice-room/e2e/voice-room.spec.ts`: headless routing, setup, layout, and console coverage.

### Root integration

- Modify `package.json`: delegate default dev/build/E2E to the independent app while preserving legacy test/build commands.
- Modify `start-demo.sh`: install and start the independent app.
- Modify `README.md`: make voice room the default demo and document the copyable directory.
- Modify `tests/startDemoScript.test.ts`: assert root delegation and port 8080.

## Task 1: Scaffold the Independent Application

**Files:**
- Create: `demos/voice-room/package.json`
- Create: `demos/voice-room/index.html`
- Create: `demos/voice-room/tsconfig.json`
- Create: `demos/voice-room/tsconfig.app.json`
- Create: `demos/voice-room/tsconfig.node.json`
- Create: `demos/voice-room/vite.config.ts`
- Create: `demos/voice-room/playwright.config.ts`
- Create: `demos/voice-room/src/test/setup.ts`
- Create: `demos/voice-room/src/main.tsx`
- Create: `demos/voice-room/src/app/App.tsx`
- Create: `demos/voice-room/src/app/App.test.tsx`

- [ ] **Step 1: Write the failing app identity test**

```tsx
render(<MemoryRouter><App /></MemoryRouter>);
expect(screen.getByRole('heading', { name: '语聊房 RTM + RTC 实践' })).toBeVisible();
expect(screen.getByText('请佩戴耳机')).toBeVisible();
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm --prefix demos/voice-room test -- src/app/App.test.tsx`

Expected: FAIL because the independent package and app do not exist.

- [ ] **Step 3: Create the package and minimal app**

Use these runtime dependencies exactly:

```json
{
  "agora-rtm": "2.2.4",
  "agora-rtc-sdk-ng": "latest",
  "lucide-react": "latest",
  "react": "latest",
  "react-dom": "latest",
  "react-router-dom": "latest"
}
```

Configure `dev` as `vite --port 8080`, `build` as `tsc -b && vite build`, `test` as `vitest run`, and `test:e2e` as `playwright test`. Configure Vitest with jsdom and Playwright with headless desktop/mobile projects. Use the dedicated Chrome for Testing executable when present, matching the root project pattern.

- [ ] **Step 4: Install standalone dependencies**

Run: `npm install --prefix demos/voice-room`

Expected: independent `package-lock.json` and `node_modules/` are created; `npm --prefix demos/voice-room ls agora-rtm agora-rtc-sdk-ng` reports RTM 2.2.4 and the installed latest RTC version.

- [ ] **Step 5: Run the identity test and verify GREEN**

Run: `npm --prefix demos/voice-room test -- src/app/App.test.tsx`

Expected: one passing test with no React warning.

## Task 2: Define the Voice-Room Domain and Pure Transitions

**Files:**
- Create: `demos/voice-room/src/domain/types.ts`
- Create: `demos/voice-room/src/domain/transitions.ts`
- Create: `demos/voice-room/src/domain/transitions.test.ts`

- [ ] **Step 1: Write failing transition tests**

Cover literals independent of implementation:

```ts
expect(createInitialSnapshot('host-1').seats['seat-0']).toMatchObject({
  userId: 'host-1', status: 'joining', muted: false,
});
expect(requestSeat(snapshot, request).queue).toEqual([request]);
expect(approveRequest(snapshot, request.id).seats['seat-1'].status).toBe('joining');
expect(activateSeat(joining, 'seat-1', 'audience-1').seats['seat-1'].status).toBe('active');
expect(rollbackJoiningSeat(joining, 'seat-1').seats['seat-1'].status).toBe('empty');
expect(banMember(active, 'audience-1').bannedUserIds).toContain('audience-1');
```

Also cover duplicate requests, occupied seats, non-host governance, invitation acceptance/rejection, mute/unmute, leave, kick, announcement, monotonic revision, and immutable inputs.

- [ ] **Step 2: Run transition tests and verify RED**

Run: `npm --prefix demos/voice-room test -- src/domain/transitions.test.ts`

Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Define stable domain types**

```ts
export type EndpointRole = 'host' | 'audience';
export type SeatStatus = 'empty' | 'joining' | 'active' | 'muted';

export interface SeatState {
  seatId: string;
  userId?: string;
  displayName?: string;
  status: SeatStatus;
  muted: boolean;
}

export interface SeatRequest {
  id: string;
  userId: string;
  displayName: string;
  seatId: string;
  createdAt: number;
}

export interface SeatInvitation extends SeatRequest {
  hostUserId: string;
}

export interface VoiceRoomSnapshot {
  revision: number;
  hostUserId: string;
  announcement: string;
  seats: Record<string, SeatState>;
  queue: SeatRequest[];
  invitation: SeatInvitation | null;
  bannedUserIds: string[];
}
```

Expose pure functions named in Step 1. Every successful mutation returns revision + 1; invalid transitions throw a Chinese `VoiceRoomDomainError` with a stable code.

- [ ] **Step 4: Implement the minimal transitions and verify GREEN**

Run: `npm --prefix demos/voice-room test -- src/domain/transitions.test.ts`

Expected: all domain transition tests pass.

## Task 3: Implement the RTM Message Protocol

**Files:**
- Create: `demos/voice-room/src/domain/protocol.ts`
- Create: `demos/voice-room/src/domain/protocol.test.ts`

- [ ] **Step 1: Write failing protocol tests**

```ts
const message = createEnvelope({
  type: 'seat.request', roomId: 'room-1', senderId: 'audience-1',
  targetId: 'host-1', requiresAck: true, payload: { seatId: 'seat-1' },
});
expect(parseEnvelope(JSON.stringify(message), { roomId: 'room-1', userId: 'host-1', now: message.sentAt })).toEqual(message);
expect(() => parseEnvelope('{"schemaVersion":2}', context)).toThrow('不支持的消息版本');
expect(() => parseEnvelope(expired, context)).toThrow('消息已过期');
expect(() => parseEnvelope(wrongTarget, context)).toThrow('消息目标不匹配');
expect(createMessageDeduper().accept(message.messageId)).toBe(true);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix demos/voice-room test -- src/domain/protocol.test.ts`

- [ ] **Step 3: Implement the envelope**

```ts
export interface VoiceRoomEnvelope {
  schemaVersion: 1;
  messageId: string;
  type: string;
  roomId: string;
  senderId: string;
  targetId?: string;
  sentAt: number;
  expiresAt: number;
  requiresAck: boolean;
  payload: Record<string, unknown>;
}
```

Validate every required field, enforce schema 1, reject wrong room/target and expired messages, and provide bounded deduplication with a maximum of 500 IDs.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm --prefix demos/voice-room test -- src/domain/protocol.test.ts`

## Task 4: Define Ports and Lock-Guarded Snapshot Storage

**Files:**
- Create: `demos/voice-room/src/runtime/ports/RtmPort.ts`
- Create: `demos/voice-room/src/runtime/ports/RtcPort.ts`
- Create: `demos/voice-room/src/runtime/RoomStateRepository.ts`
- Create: `demos/voice-room/src/runtime/RoomStateRepository.test.ts`

- [ ] **Step 1: Write failing repository tests with an in-memory RTM port**

Verify the exact mutation order:

```ts
expect(port.operations).toEqual([
  'lock:acquire:room-state',
  'storage:get',
  'storage:set:2:room-state',
  'lock:release:room-state',
]);
```

Also verify release in `finally`, conflict refresh without overwrite, malformed/missing snapshot fallback, and listener delivery.

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix demos/voice-room test -- src/runtime/RoomStateRepository.test.ts`

- [ ] **Step 3: Define SDK-independent ports**

`RtmPort` exposes event registration, connect/disconnect, subscribe/unsubscribe, channel/user publish, Presence query, Storage read/write, and Lock acquire/release. `RtcPort` exposes event registration, join/leave, publish microphone, unpublish microphone, set local mute, and remote-audio publication state.

```ts
export interface RtcPort {
  registerEvents(handlers: RtcPortHandlers): void;
  join(settings: { appId: string; roomId: string; userId: string; token: string }): Promise<void>;
  leave(): Promise<void>;
  publishMicrophone(): Promise<void>;
  unpublishMicrophone(): Promise<void>;
  setMicrophoneMuted(muted: boolean): Promise<void>;
}
```

- [ ] **Step 4: Implement `RoomStateRepository`**

Use one Storage key `voice-room-state` and one mutation Lock `room-state`. `mutate` must acquire, re-read, apply a pure callback, write the supplied next snapshot using the current major revision and lock name, then release in `finally`.

- [ ] **Step 5: Run and verify GREEN**

Run: `npm --prefix demos/voice-room test -- src/runtime/RoomStateRepository.test.ts`

## Task 5: Build One Endpoint Runtime Through the Core Seat Flow

**Files:**
- Create: `demos/voice-room/src/runtime/VoiceRoomClient.ts`
- Create: `demos/voice-room/src/runtime/VoiceRoomClient.test.ts`
- Create: `demos/voice-room/src/runtime/testing/MemoryRtmPort.ts`
- Create: `demos/voice-room/src/runtime/testing/MemoryRtcPort.ts`

- [ ] **Step 1: Write the failing connection-order test**

```ts
await client.connect();
expect(operations).toEqual([
  'rtm:register-events', 'rtc:register-events', 'rtm:connect:host-1',
  'rtm:subscribe:room-1', 'presence:get:room-1', 'storage:get',
  'rtc:join:room-1:host-1', 'rtc:publish-microphone',
]);
```

The state becomes ready only after both transports and hydration complete.

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix demos/voice-room test -- src/runtime/VoiceRoomClient.test.ts`

- [ ] **Step 3: Implement endpoint configuration and state**

```ts
export interface EndpointSettings {
  role: EndpointRole;
  appId: string;
  roomId: string;
  userId: string;
  displayName: string;
  rtmToken: string;
  rtcToken: string;
}

export interface VoiceRoomClientState {
  rtmState: ConnectionState;
  rtcState: ConnectionState;
  hydrating: boolean;
  snapshot: VoiceRoomSnapshot;
  onlineUsers: string[];
  interactions: InteractionEvent[];
  events: TimelineEvent[];
}
```

Expose `subscribe`, `getState`, `connect`, `disconnect`, `execute(command)`, and `destroy`. Catch every async action failure and append a normalized error event.

- [ ] **Step 4: Write the failing audience approval/media gate test**

Assert audience request is persisted, host approval reserves `joining`, audience publishes RTC, and only `media.ready` changes the seat to `active`. Configure `MemoryRtcPort.publishMicrophone` to fail and assert the seat returns to `empty`.

- [ ] **Step 5: Implement request, cancel, approve, reject, and media-ready orchestration**

Use targeted RTM messages for decisions and repository mutations for durable queue/seat state. Correlate operations with message/request IDs. Release joining seats on RTC publish failure.

- [ ] **Step 6: Run and verify GREEN**

Run: `npm --prefix demos/voice-room test -- src/runtime/VoiceRoomClient.test.ts`

## Task 6: Complete Invitations, Seat Control, and Governance

**Files:**
- Modify: `demos/voice-room/src/runtime/VoiceRoomClient.ts`
- Modify: `demos/voice-room/src/runtime/VoiceRoomClient.test.ts`
- Modify: `demos/voice-room/src/domain/transitions.ts`
- Modify: `demos/voice-room/src/domain/transitions.test.ts`

- [ ] **Step 1: Add one failing vertical test per workflow**

Cover host invitation/accept/reject, self mute/unmute, voluntary leave, host mute/unmute request, forced off-seat, kick, ban, banned reconnect denial, and command ACK timeout. Each test observes public client state and port operations, not private methods.

- [ ] **Step 2: Run tests and verify RED for the new workflow**

Run after each added test: `npm --prefix demos/voice-room test -- src/runtime/VoiceRoomClient.test.ts`

- [ ] **Step 3: Implement the minimal command union and orchestration slice**

```ts
export type VoiceRoomCommand =
  | { type: 'seat.request'; seatId: string }
  | { type: 'seat.request.cancel' }
  | { type: 'seat.request.approve'; requestId: string }
  | { type: 'seat.request.reject'; requestId: string }
  | { type: 'seat.invite'; userId: string; displayName: string; seatId: string }
  | { type: 'seat.invite.accept' }
  | { type: 'seat.invite.reject' }
  | { type: 'seat.mute'; muted: boolean; userId?: string }
  | { type: 'seat.leave'; userId?: string }
  | { type: 'member.kick'; userId: string }
  | { type: 'member.ban'; userId: string };
```

Enforce role permissions in the runtime and pure transitions. Targeted governance commands require EXECUTED ACK. Timeout records a visible error but does not falsely claim execution.

- [ ] **Step 4: Verify all governance tests GREEN**

Run: `npm --prefix demos/voice-room test -- src/domain/transitions.test.ts src/runtime/VoiceRoomClient.test.ts`

## Task 7: Add Social Interaction and Announcement

**Files:**
- Modify: `demos/voice-room/src/domain/types.ts`
- Modify: `demos/voice-room/src/runtime/VoiceRoomClient.ts`
- Modify: `demos/voice-room/src/runtime/VoiceRoomClient.test.ts`

- [ ] **Step 1: Write failing public interaction tests**

Verify `chat.send`, `emoji.send`, and `gift.send` publish channel envelopes and append received events exactly once. Verify a host announcement mutates Storage and an audience announcement attempt is rejected.

- [ ] **Step 2: Run and verify RED**

Run: `npm --prefix demos/voice-room test -- src/runtime/VoiceRoomClient.test.ts`

- [ ] **Step 3: Add interaction commands**

```ts
type SocialCommand =
  | { type: 'chat.send'; text: string }
  | { type: 'emoji.send'; emoji: string }
  | { type: 'gift.send'; giftId: 'rose' | 'applause' | 'rocket' }
  | { type: 'announcement.update'; text: string };
```

Trim and reject empty chat/announcement text, cap visible interaction history at 100 events, and deduplicate messages by `messageId`.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm --prefix demos/voice-room test -- src/runtime/VoiceRoomClient.test.ts`

## Task 8: Implement Agora RTM and RTC Adapters

**Files:**
- Create: `demos/voice-room/src/runtime/agora/AgoraRtmAdapter.ts`
- Create: `demos/voice-room/src/runtime/agora/AgoraRtcAdapter.ts`
- Create: `demos/voice-room/src/runtime/agora/errorMap.ts`
- Create: `demos/voice-room/src/runtime/agora/errorMap.test.ts`

- [ ] **Step 1: Inspect installed declarations before adapter code**

Run:

```bash
rg -n "class RTM|publish\(|subscribe\(|getOnlineUsers|getChannelMetadata|setChannelMetadata|acquireLock" demos/voice-room/node_modules/agora-rtm
rg -n "createClient|join\(|user-published|subscribe\(|createMicrophoneAudioTrack|setMuted|setEnabled" demos/voice-room/node_modules/agora-rtc-sdk-ng
```

Expected: exact installed SDK signatures are identified; no method name is guessed.

- [ ] **Step 2: Write failing Chinese error-map tests**

Cover invalid/expired RTM Token, invalid RTC Token, microphone permission denial, duplicate login, network disconnect, Lock conflict, and safe defaults.

- [ ] **Step 3: Implement adapters against exact declarations**

Register listeners before login/join. RTM subscribes with message, Presence, Storage, and Lock enabled. RTC creates an audio-only client, subscribes and calls `remoteAudioTrack.play()` for published audio, owns one local microphone track, and performs idempotent leave/track close cleanup.

- [ ] **Step 4: Run adapter type-check and tests**

Run: `npm --prefix demos/voice-room test -- src/runtime/agora/errorMap.test.ts && npm --prefix demos/voice-room run build`

Expected: error tests pass and TypeScript accepts both SDK integrations.

## Task 9: Build Setup, Dual-Client Room UI, and Responsive Styling

**Files:**
- Create: `demos/voice-room/src/app/connectionSettings.ts`
- Create: `demos/voice-room/src/app/connectionSettings.test.ts`
- Create: `demos/voice-room/src/app/SetupPage.tsx`
- Create: `demos/voice-room/src/app/SetupPage.test.tsx`
- Create: `demos/voice-room/src/app/RoomPage.tsx`
- Create: `demos/voice-room/src/app/RoomPage.test.tsx`
- Create: `demos/voice-room/src/components/VoiceRoomClientView.tsx`
- Create: `demos/voice-room/src/components/SeatGrid.tsx`
- Create: `demos/voice-room/src/components/RequestQueue.tsx`
- Create: `demos/voice-room/src/components/InteractionPanel.tsx`
- Create: `demos/voice-room/src/components/EventTimeline.tsx`
- Create: `demos/voice-room/src/components/HeadphonesWarning.tsx`
- Create: `demos/voice-room/src/styles.css`
- Modify: `demos/voice-room/src/app/App.tsx`

- [ ] **Step 1: Write failing settings tests**

Assert every field is required, host/audience IDs must differ, secrets are never written to localStorage, and normalized settings are stored under one sessionStorage key.

- [ ] **Step 2: Implement setup and verify GREEN**

The submit button is a clear command with a plug icon. Password inputs are used for Tokens. No App Certificate field or visible secret is rendered after entering the room.

- [ ] **Step 3: Write failing room composition tests with injected memory clients**

Assert two endpoint landmarks exist on desktop, only role-permitted actions appear, eight stable seats render, host queue actions update the shared snapshot, invitation actions appear on audience, and mobile tabs show one endpoint without removing the other runtime.

- [ ] **Step 4: Implement room composition**

Create two independent adapters and runtimes only after the user clicks Connect. Subscribe React state to each runtime. Disconnect and destroy both on route exit. Keep endpoint view props limited to state and command callbacks.

- [ ] **Step 5: Implement the visual system**

Use white/gray operational surfaces, near-black text, green connection/media state, amber pending state, red governance/destructive state, and limited indigo for RTM controls. Use Lucide icons, cards only for repeated seats/messages, border radius <= 8px, no gradients/orbs, no viewport-scaled fonts, and no negative letter spacing.

Desktop constraints:

```css
.dual-room { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.seat-grid { display: grid; grid-template-columns: repeat(4, minmax(72px, 1fr)); }
```

At <= 840px, use endpoint tabs and a two-column seat grid. Stable min-heights prevent connection, queue, and timeline content from shifting the control layout.

- [ ] **Step 6: Run component tests and verify GREEN**

Run: `npm --prefix demos/voice-room test -- src/app/connectionSettings.test.ts src/app/SetupPage.test.tsx src/app/RoomPage.test.tsx`

## Task 10: Root Delegation, Standalone Launchers, and Documentation

**Files:**
- Create: `demos/voice-room/start-demo.sh`
- Create: `demos/voice-room/README.md`
- Modify: `package.json`
- Modify: `start-demo.sh`
- Modify: `README.md`
- Modify: `tests/startDemoScript.test.ts`

- [ ] **Step 1: Extend the failing root launcher test**

Assert `./start-demo.sh --check` reports `demos/voice-room`, default URL 8080, and standalone dependencies. Assert `package.json` default dev/build commands delegate with `npm --prefix demos/voice-room`.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tests/startDemoScript.test.ts`

- [ ] **Step 3: Implement standalone and root launchers**

The child script installs its own dependencies when `node_modules/.bin/vite` is missing. Root script delegates to it without copying environment secrets. Both support `--no-open`, `--check`, and `RTM_DEMO_HOST`/`RTM_DEMO_PORT`, defaulting to `127.0.0.1:8080`.

Root scripts become:

```json
{
  "dev": "npm --prefix demos/voice-room run dev",
  "build": "npm --prefix demos/voice-room run build",
  "test": "vitest run && npm --prefix demos/voice-room test",
  "test:legacy": "vitest run",
  "build:legacy": "tsc -b && vite build",
  "test:e2e": "npm --prefix demos/voice-room run test:e2e"
}
```

- [ ] **Step 4: Write standalone documentation**

Document copying only `demos/voice-room`, install/start commands, both endpoints' manual RTM/RTC Tokens, identical room/User ID mapping, mandatory headphones, the complete workflow checklist, sessionStorage behavior, and cooperative-governance limitations.

- [ ] **Step 5: Run launcher tests and verify GREEN**

Run: `npm test -- tests/startDemoScript.test.ts`

## Task 11: Headless E2E and Final Verification

**Files:**
- Create: `demos/voice-room/e2e/voice-room.spec.ts`

- [ ] **Step 1: Write headless browser tests**

Cover setup rendering, all-field validation, duplicate User ID validation, sessionStorage persistence, unknown-route redirect, desktop dual-panel layout, mobile role tabs, headphones warning, no legacy scenario navigation, no page errors, and no console errors.

- [ ] **Step 2: Run E2E and verify RED/GREEN as behavior is completed**

Run: `npm --prefix demos/voice-room run test:e2e`

Expected: desktop and mobile projects pass; project-specific layout tests skip only on the other viewport project.

- [ ] **Step 3: Capture and inspect screenshots**

Capture setup at 1440x1000, then seed placeholder settings in `sessionStorage` and capture the disconnected room shell at 1440x1000 and 390x844 without clicking Connect or contacting Agora. Inspect for blank regions, overlap, clipping, horizontal overflow, unreadable Token fields, and unstable seat dimensions.

- [ ] **Step 4: Run complete verification**

```bash
npm test
npm run build
npm run test:e2e
./start-demo.sh --check
```

Expected: all root legacy tests, independent demo tests, production build, and headless browser tests pass. Build may retain the documented upstream `agora-rtm` direct-eval/chunk warning but has no application TypeScript error.

- [ ] **Step 5: Start the final server**

Run: `./start-demo.sh --no-open`

Expected: only the independent voice-room SPA is served at `http://127.0.0.1:8080/`. Keep the process running and provide the URL and its terminal session ID.
