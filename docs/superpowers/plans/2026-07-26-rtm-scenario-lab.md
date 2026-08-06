# RTM 2.x Scenario Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a responsive Chinese RTM scenario lab with 24 clickable scenario routes and real `agora-rtm@2.2.4` transport for voice-room seat management and IoT device control.

**Architecture:** A typed scenario catalog drives a shared React workbench and eight canvas families. A deterministic simulation store handles every route, while an RTM port isolates the Agora SDK and lets the two real scenarios reuse the same normalized commands, snapshots, and timeline events.

**Tech Stack:** Vite, React, TypeScript, React Router, Lucide React, `agora-rtm@2.2.4`, Vitest, Testing Library, Playwright, CSS.

**Repository note:** The working directory is not a Git repository. Do not initialize Git, stage files, or create commits unless the user explicitly requests it.

**RTC note:** This release does not publish or subscribe to media, so it does not install `agora-rtc-sdk-ng`. If real media is added later, use `agora-rtc-sdk-ng@latest` as requested.

---

## File Map

- `package.json`: scripts and runtime/test dependencies.
- `vite.config.ts`, `tsconfig*.json`, `index.html`: Vite and TypeScript setup.
- `playwright.config.ts`: headless desktop/mobile end-to-end configuration.
- `src/domain/scenario.ts`: scenario, action, state, and event types.
- `src/domain/scenarioCatalog.ts`: all 8 groups and 24 scenario definitions.
- `src/domain/scenarioCatalog.test.ts`: catalog completeness and invariants.
- `src/runtime/protocol.ts`: normalized RTM envelope parsing and creation.
- `src/runtime/protocol.test.ts`: schema and deduplication behavior.
- `src/runtime/simulation.ts`: deterministic state transitions shared by all prototypes.
- `src/runtime/simulation.test.ts`: transition and reset behavior.
- `src/runtime/rtm/RtmPort.ts`: SDK-independent RTM contract.
- `src/runtime/rtm/AgoraRtmAdapter.ts`: the only production module importing `agora-rtm`.
- `src/runtime/rtm/errorMap.ts`: Chinese SDK error normalization.
- `src/runtime/rtm/realScenarioRuntime.ts`: voice-room and IoT orchestration.
- `src/runtime/rtm/realScenarioRuntime.test.ts`: in-memory port contract tests.
- `src/app/App.tsx`, `src/main.tsx`: routing and application bootstrap.
- `src/app/ScenarioWorkbench.tsx`: runtime lifecycle and page composition.
- `src/components/AppShell.tsx`: responsive application structure.
- `src/components/ScenarioNavigation.tsx`: grouped scenario navigation.
- `src/components/TopBar.tsx`: title, role, runtime, connection, and mobile navigation.
- `src/components/RoleSwitcher.tsx`: role selection.
- `src/components/ActionPanel.tsx`: context-sensitive scenario actions.
- `src/components/EventTimeline.tsx`: normalized event feed.
- `src/components/CapabilityDrawer.tsx`: business action to RTM capability mapping.
- `src/components/ConnectionDialog.tsx`: session-only RTM credentials.
- `src/components/ScenarioCanvas.tsx`: dispatch to eight canvas families.
- `src/components/canvases/*.tsx`: room, classroom, device, meeting, order, call, chat, and operations canvases.
- `src/components/App.test.tsx`: routing and workbench interaction coverage.
- `src/styles.css`: complete responsive visual system.
- `e2e/scenarios.spec.ts`: all-route headless smoke coverage.

## Task 1: Scaffold the Application and Test Harness

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `playwright.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`

- [ ] **Step 1: Create the package manifest**

Use these scripts and dependencies:

```json
{
  "name": "rtm-scenario-lab",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "agora-rtm": "2.2.4",
    "lucide-react": "latest",
    "react": "latest",
    "react-dom": "latest",
    "react-router-dom": "latest"
  },
  "devDependencies": {
    "@playwright/test": "latest",
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@testing-library/user-event": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@vitejs/plugin-react": "latest",
    "jsdom": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and `npm ls agora-rtm` reports `agora-rtm@2.2.4`.

- [ ] **Step 3: Add TypeScript, Vite, and test configuration**

Configure the app for strict TypeScript, DOM libraries, React JSX, Vitest `jsdom`, and `src/test/setup.ts`. Configure Playwright with `headless: true`, a desktop Chromium project, a mobile Chromium project, and `http://127.0.0.1:4173` as `baseURL`.

The Vite test block must be:

```ts
test: {
  environment: 'jsdom',
  setupFiles: ['./src/test/setup.ts'],
  css: true,
}
```

The Playwright web server must run `npm run dev -- --host 127.0.0.1 --port 4173` and reuse an existing server outside CI.

- [ ] **Step 4: Add the first failing render test**

Create `src/app/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the RTM scenario lab identity', () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByText('RTM 场景实验室')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the test and verify RED**

Run: `npm test -- src/app/App.test.tsx`

Expected: FAIL because `App` does not yet render the identity.

- [ ] **Step 6: Add the minimal application shell**

Make `App` render a `<main>` with the text `RTM 场景实验室`, and mount it from `src/main.tsx` under `BrowserRouter`.

- [ ] **Step 7: Run the test and verify GREEN**

Run: `npm test -- src/app/App.test.tsx`

Expected: one passing test with no console warning.

## Task 2: Define the Scenario Model and Complete Catalog

**Files:**
- Create: `src/domain/scenario.ts`
- Create: `src/domain/scenarioCatalog.ts`
- Create: `src/domain/scenarioCatalog.test.ts`

- [ ] **Step 1: Write catalog invariant tests**

The tests must assert:

```ts
expect(scenarioGroups).toHaveLength(8);
expect(allScenarios).toHaveLength(24);
expect(new Set(allScenarios.map((scene) => scene.id)).size).toBe(24);
expect(new Set(allScenarios.map((scene) => scene.canvas))).toEqual(
  new Set(['room', 'classroom', 'device', 'meeting', 'order', 'call', 'chat', 'operations']),
);
expect(allScenarios.every((scene) => scene.roles.length >= 2)).toBe(true);
expect(allScenarios.every((scene) => scene.actions.length >= 3 && scene.actions.length <= 6)).toBe(true);
expect(allScenarios.filter((scene) => scene.supportsRealRtm).map((scene) => scene.id)).toEqual([
  'voice-room-seats',
  'device-control',
]);
```

- [ ] **Step 2: Run the catalog test and verify RED**

Run: `npm test -- src/domain/scenarioCatalog.test.ts`

Expected: FAIL because the catalog modules do not exist.

- [ ] **Step 3: Define focused domain types**

Define these stable shapes in `scenario.ts`:

```ts
export type CanvasKind = 'room' | 'classroom' | 'device' | 'meeting' | 'order' | 'call' | 'chat' | 'operations';
export type Capability = '用户消息' | '消息频道' | 'Presence' | 'Storage' | 'Lock';
export type EventKind = 'local' | 'sent' | 'received' | 'ack' | 'state' | 'connection' | 'error';

export interface ScenarioAction {
  id: string;
  label: string;
  nextStatus: string;
  eventText: string;
  capabilities: Capability[];
  tone?: 'default' | 'danger';
}

export interface ScenarioDefinition {
  id: string;
  groupId: string;
  title: string;
  summary: string;
  canvas: CanvasKind;
  roles: { id: string; label: string }[];
  initialStatus: string;
  actions: ScenarioAction[];
  supportsRealRtm?: boolean;
}

export interface ScenarioGroup {
  id: string;
  label: string;
  scenarios: ScenarioDefinition[];
}

export interface TimelineEvent {
  id: string;
  kind: EventKind;
  text: string;
  timestamp: number;
}
```

- [ ] **Step 4: Implement all eight groups and 24 definitions**

Use the exact IDs and titles from the approved design specification. Each definition supplies two or more roles, a short business summary, one of the eight canvas values, an initial status, and three to six actions. Action sequences use these status vocabularies:

```ts
const statusFlows = {
  call: ['空闲', '振铃中', '通话中', '已结束'],
  order: ['待派单', '待接单', '服务中', '已完成'],
  classroom: ['听课中', '已举手', '发言中', '已落座'],
  alert: ['正常', '告警中', '处理中', '已恢复'],
  chat: ['在线', '消息已发送', '已送达', '已读'],
  room: ['围观中', '申请中', '互动中', '已结束'],
  device: ['在线', '指令已发送', '执行中', '执行完成'],
  meeting: ['待入会', '会议中', '共享中', '已结束'],
} as const;
```

Export `scenarioGroups`, flattened `allScenarios`, and `getScenario(id)`.

- [ ] **Step 5: Run the catalog tests and verify GREEN**

Run: `npm test -- src/domain/scenarioCatalog.test.ts`

Expected: all catalog invariants pass.

## Task 3: Build the Protocol and Simulation Runtime

**Files:**
- Create: `src/runtime/protocol.ts`
- Create: `src/runtime/protocol.test.ts`
- Create: `src/runtime/simulation.ts`
- Create: `src/runtime/simulation.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Cover valid parsing, unsupported schema, missing identifiers, and duplicate handling:

```ts
const message = createEnvelope({
  sceneId: 'device-control',
  type: 'device.command',
  senderId: 'controller-1',
  targetId: 'device-1',
  channelId: 'devices',
  requiresAck: true,
  payload: { command: 'power.on' },
});
expect(parseEnvelope(JSON.stringify(message))).toEqual(message);
expect(() => parseEnvelope('{"schemaVersion":2}')).toThrow('不支持的消息版本');
const deduper = createMessageDeduper();
expect(deduper.accept(message.messageId)).toBe(true);
expect(deduper.accept(message.messageId)).toBe(false);
```

- [ ] **Step 2: Run protocol tests and verify RED**

Run: `npm test -- src/runtime/protocol.test.ts`

Expected: FAIL because protocol functions do not exist.

- [ ] **Step 3: Implement protocol validation**

Create UUID-backed envelopes with `schemaVersion: 1` and `sentAt: Date.now()`. Parse JSON using type checks for every required field. Keep deduplication as a closure over `Set<string>` and expose only `accept(messageId)` and `clear()`.

- [ ] **Step 4: Run protocol tests and verify GREEN**

Run: `npm test -- src/runtime/protocol.test.ts`

Expected: all protocol tests pass.

- [ ] **Step 5: Write failing simulation tests**

Assert that creating a session uses the catalog's initial state, executing an action changes status and appends a normalized event, role changes preserve state, and reset clears events:

```ts
const session = createSimulationSession(getScenario('dispatch-order')!);
const offered = reduceSimulation(session, { type: 'execute', actionId: 'dispatch' });
expect(offered.status).toBe('待接单');
expect(offered.events.at(-1)?.text).toContain('派单');
const switched = reduceSimulation(offered, { type: 'role', roleId: 'driver' });
expect(switched.status).toBe('待接单');
expect(reduceSimulation(switched, { type: 'reset' }).events).toEqual([]);
```

- [ ] **Step 6: Run simulation tests and verify RED**

Run: `npm test -- src/runtime/simulation.test.ts`

Expected: FAIL because the simulation reducer does not exist.

- [ ] **Step 7: Implement the reducer**

Represent session state as:

```ts
export interface SimulationSession {
  sceneId: string;
  roleId: string;
  status: string;
  revision: number;
  events: TimelineEvent[];
  lastActionId?: string;
}
```

Reject unknown action IDs without mutating state. Increment `revision` only for successful business actions. Create stable event IDs with `crypto.randomUUID()`.

- [ ] **Step 8: Run simulation tests and verify GREEN**

Run: `npm test -- src/runtime/simulation.test.ts`

Expected: protocol and simulation suites pass.

## Task 4: Build Routing, Navigation, and the Shared Workbench

**Files:**
- Create: `src/components/AppShell.tsx`
- Create: `src/components/ScenarioNavigation.tsx`
- Create: `src/components/TopBar.tsx`
- Create: `src/components/RoleSwitcher.tsx`
- Create: `src/components/ActionPanel.tsx`
- Create: `src/components/EventTimeline.tsx`
- Create: `src/components/CapabilityDrawer.tsx`
- Create: `src/app/ScenarioWorkbench.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add failing routing and interaction tests**

Tests must verify:

```tsx
render(<MemoryRouter initialEntries={['/scenarios/dispatch-order']}><App /></MemoryRouter>);
expect(screen.getByRole('heading', { name: '派单与订单状态' })).toBeInTheDocument();
await userEvent.click(screen.getByRole('button', { name: '派单' }));
expect(screen.getByText('待接单')).toBeInTheDocument();
expect(screen.getByLabelText('事件时间线')).toHaveTextContent('派单');
await userEvent.click(screen.getByRole('radio', { name: '司机' }));
expect(screen.getByText('待接单')).toBeInTheDocument();
```

Also test `/missing` and an unknown scenario ID render `未找到这个场景` with a link to the first route.

- [ ] **Step 2: Run app tests and verify RED**

Run: `npm test -- src/app/App.test.tsx`

Expected: FAIL because routes and controls are missing.

- [ ] **Step 3: Implement route composition**

Use `<Routes>` with root redirect, `/scenarios/:scenarioId`, and wildcard routes. `ScenarioWorkbench` obtains the definition via `useParams`, initializes the reducer with `createSimulationSession`, and resets the reducer when the scene ID changes.

- [ ] **Step 4: Implement accessible controls**

- Navigation links use their scenario titles and `aria-current` through `NavLink`.
- Role selector uses a labeled radio group.
- Action buttons use catalog labels and include Lucide icons selected by action semantics.
- Timeline uses `aria-label="事件时间线"` and `<time>` values.
- Capability drawer uses a standard dialog/drawer pattern with close button and Escape support.
- Reset is an icon button with `RotateCcw` and a tooltip/accessible name.

- [ ] **Step 5: Run app tests and verify GREEN**

Run: `npm test -- src/app/App.test.tsx`

Expected: routing and interactions pass without accessibility or React warnings.

## Task 5: Implement the Eight Scenario Canvas Families and Visual System

**Files:**
- Create: `src/components/ScenarioCanvas.tsx`
- Create: `src/components/canvases/RoomCanvas.tsx`
- Create: `src/components/canvases/ClassroomCanvas.tsx`
- Create: `src/components/canvases/DeviceCanvas.tsx`
- Create: `src/components/canvases/MeetingCanvas.tsx`
- Create: `src/components/canvases/OrderCanvas.tsx`
- Create: `src/components/canvases/CallCanvas.tsx`
- Create: `src/components/canvases/ChatCanvas.tsx`
- Create: `src/components/canvases/OperationsCanvas.tsx`
- Create: `src/components/ScenarioCanvas.test.tsx`
- Create: `src/styles.css`

- [ ] **Step 1: Write a failing canvas dispatch test**

Render one scenario per canvas kind and assert a unique labeled landmark:

```ts
const expected = {
  room: '房间状态',
  classroom: '课堂状态',
  device: '设备状态',
  meeting: '会议状态',
  order: '订单状态',
  call: '通话状态',
  chat: '消息与联系人',
  operations: '现场状态',
};
```

Assert the voice-room seat canvas contains eight stable seat positions and the device canvas contains power, network, battery, and temperature readings.

- [ ] **Step 2: Run canvas tests and verify RED**

Run: `npm test -- src/components/ScenarioCanvas.test.tsx`

Expected: FAIL because canvas components do not exist.

- [ ] **Step 3: Implement canvas dispatch and focused canvases**

Each canvas receives only `{ scenario, session }`. Use Lucide icons rather than custom SVG. Keep fixed-format regions stable with CSS grid tracks, aspect ratios, and minimum heights.

Required visual structures:

- Room: stage/host area, 8-seat grid, audience strip, and interaction feed.
- Classroom: teacher stage, participant roster, prompt/poll region, and speaking indicator.
- Device: product silhouette built from CSS surfaces, telemetry rows, connection path, and command status.
- Meeting: participant grid, active speaker, sharing surface, and attendee status.
- Order: vertical order progression, assignee summary, and location/status facts.
- Call: caller/callee identity, ringing/connected state, duration surface, and privacy indicator.
- Chat: contact list, conversation thread, delivery/read markers, and status dots.
- Operations: site overview, asset rows, alert severity, assignee, and resolution state.

- [ ] **Step 4: Implement the responsive visual system**

Use CSS custom properties with a neutral white/gray foundation, near-black text, green for connected/success, amber for pending, red for errors, and limited indigo as the RTM accent. Do not use gradients, decorative blobs, negative letter spacing, viewport-scaled type, or nested cards.

Use these layout constraints:

```css
.app-shell { grid-template-columns: 264px minmax(0, 1fr); }
.workbench { grid-template-columns: minmax(520px, 1fr) 340px; }
.scene-canvas { min-height: 520px; }
.seat-grid { grid-template-columns: repeat(4, minmax(72px, 1fr)); }
@media (max-width: 1100px) { .workbench { grid-template-columns: 1fr; } }
@media (max-width: 760px) {
  .app-shell { grid-template-columns: 1fr; }
  .scene-canvas { min-height: 420px; }
  .seat-grid { grid-template-columns: repeat(2, minmax(72px, 1fr)); }
}
```

- [ ] **Step 5: Run canvas and app tests and verify GREEN**

Run: `npm test -- src/components/ScenarioCanvas.test.tsx src/app/App.test.tsx`

Expected: all component tests pass.

## Task 6: Add Connection Settings and the RTM Adapter Boundary

**Files:**
- Create: `src/runtime/rtm/RtmPort.ts`
- Create: `src/runtime/rtm/errorMap.ts`
- Create: `src/runtime/rtm/errorMap.test.ts`
- Create: `src/runtime/rtm/AgoraRtmAdapter.ts`
- Create: `src/components/ConnectionDialog.tsx`
- Create: `src/components/ConnectionDialog.test.tsx`
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Write failing credential and error tests**

Assert that submitting App ID, User ID, Token, channel ID, and target User ID writes only this session key:

```ts
expect(sessionStorage.getItem('rtm-scenario-lab.connection')).toBe(JSON.stringify({
  appId: 'app-id',
  userId: 'host-1',
  token: 'temporary-token',
  channelId: 'voice-room-001',
  targetUserId: '',
}));
expect(localStorage.length).toBe(0);
```

Verify no field or label contains `App Certificate`. Verify representative SDK errors map to `Token 无效或已过期`, `该用户已在其他设备登录`, `网络连接已断开`, and a safe default `RTM 操作失败`.

- [ ] **Step 2: Run settings tests and verify RED**

Run: `npm test -- src/components/ConnectionDialog.test.tsx src/runtime/rtm/errorMap.test.ts`

Expected: FAIL because settings and mappings do not exist.

- [ ] **Step 3: Define the RTM port**

The port exposes typed methods for `connect`, `disconnect`, `subscribe`, `unsubscribe`, `publishChannel`, `publishUser`, `getOnlineUsers`, `getChannelMetadata`, `setChannelMetadata`, `acquireLock`, `releaseLock`, and event registration. Event registration happens before connect or subscribe.

Represent connection, message, presence, and storage events as application types without leaking Agora SDK types.

- [ ] **Step 4: Inspect `agora-rtm@2.2.4` declarations before adapter code**

Run: `rg -n "class RTM|publish\(|subscribe\(|getOnlineUsers|getChannelMetadata|setChannelMetadata|acquire|release" node_modules/agora-rtm`

Expected: declaration signatures for version 2.2.4 are located. Implement against those exact signatures; do not guess SDK method or event names.

- [ ] **Step 5: Implement the adapter and dialog**

`AgoraRtmAdapter.ts` is the only file that imports `agora-rtm`. Register SDK listeners before login and normalize SDK payloads at the boundary. The dialog validates non-empty App ID, User ID, and Token before saving, never logs credentials, and lets channel/target fields be filled per real scenario.

- [ ] **Step 6: Run settings and error tests and verify GREEN**

Run: `npm test -- src/components/ConnectionDialog.test.tsx src/runtime/rtm/errorMap.test.ts`

Expected: all settings and error tests pass.

- [ ] **Step 7: Type-check the real adapter**

Run: `npm run build`

Expected: TypeScript accepts all `agora-rtm@2.2.4` calls and Vite produces `dist/`.

## Task 7: Implement the Two Real RTM Runtimes

**Files:**
- Create: `src/runtime/rtm/realScenarioRuntime.ts`
- Create: `src/runtime/rtm/realScenarioRuntime.test.ts`
- Modify: `src/app/ScenarioWorkbench.tsx`
- Modify: `src/components/ActionPanel.tsx`
- Modify: `src/components/EventTimeline.tsx`

- [ ] **Step 1: Write a deterministic in-memory RTM port for tests**

The fake records operations in order and can emit message, presence, storage, and connection events. It implements `RtmPort` without importing or mocking `agora-rtm`.

- [ ] **Step 2: Write failing voice-room orchestration tests**

Assert this operation order for a host accepting a seat request:

```ts
expect(port.operations).toEqual([
  'register-events',
  'connect:host-1',
  'subscribe:voice-room-001',
  'presence:voice-room-001',
  'storage:get:voice-room-001',
  'lock:acquire:voice-room-001:seat-1',
  'storage:get:voice-room-001',
  'storage:set:voice-room-001:2',
  'publish:channel:voice-room-001:mic.accept',
  'lock:release:voice-room-001:seat-1',
]);
```

Also assert lock failure reloads storage and appends a conflict event without changing the seat holder.

- [ ] **Step 3: Write failing IoT ACK tests**

Assert a device receiving `device.command` sends `RECEIVED`, applies one state change, sends `EXECUTED`, and ignores a duplicate command ID. Assert an uncompleted controller command becomes timed out and exposes retry with a new message ID.

- [ ] **Step 4: Run orchestration tests and verify RED**

Run: `npm test -- src/runtime/rtm/realScenarioRuntime.test.ts`

Expected: FAIL because runtime orchestration does not exist.

- [ ] **Step 5: Implement voice-room orchestration**

On connect, register listeners, log in, subscribe, then hydrate Presence and Storage. Use Message Channel for room actions, channel metadata for `{ revision, seats }`, and `seat-N` named locks. Always release an acquired lock in `finally`. On connection restoration, repeat subscribe/hydration before enabling actions.

- [ ] **Step 6: Implement IoT orchestration**

Use user-targeted messages for commands and ACKs. Track commands by `messageId` with statuses `SENT`, `RECEIVED`, `EXECUTED`, and `TIMED_OUT`. Use a bounded timer that is cleared on execution, retry, disconnect, and component unmount.

- [ ] **Step 7: Connect runtime mode to the workbench**

Only `voice-room-seats` and `device-control` enable the segmented mode control. Switching to real mode opens settings when credentials are absent. The workbench disables mutating actions while disconnected or hydrating and preserves the last visible snapshot during a transient disconnect.

- [ ] **Step 8: Run orchestration and component tests and verify GREEN**

Run: `npm test -- src/runtime/rtm/realScenarioRuntime.test.ts src/app/App.test.tsx`

Expected: real-flow contract tests and workbench tests pass.

## Task 8: Add Headless End-to-End Coverage and Final Verification

**Files:**
- Create: `e2e/scenarios.spec.ts`
- Create: `README.md`

- [ ] **Step 1: Write the all-route Playwright test**

Import the 24 stable slugs as test data. For each route, visit `/scenarios/<slug>`, assert one visible `h1`, click the first enabled scenario action, and assert the event timeline has at least one event. Attach listeners that fail on uncaught page errors and unexpected console errors.

- [ ] **Step 2: Add responsive navigation and screenshot checks**

On desktop, assert grouped navigation and both workbench columns are visible. On mobile, open the menu button, choose `远程指令、任务与配置下发`, verify the drawer closes, and capture screenshots for:

- Desktop voice-room seats at 1440 x 1000.
- Desktop device control at 1440 x 1000.
- Mobile voice-room seats at 390 x 844.

- [ ] **Step 3: Run unit and component verification**

Run: `npm test`

Expected: all Vitest suites pass with no unhandled errors or React warnings.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: TypeScript build and Vite bundle complete successfully.

- [ ] **Step 5: Install the Playwright browser if absent**

Run: `npx playwright install chromium`

Expected: Chromium is available for headless tests.

- [ ] **Step 6: Run headless end-to-end verification**

Run: `npm run test:e2e`

Expected: all 24 routes, desktop navigation, mobile navigation, and screenshots pass in headless Chromium with no page/console errors.

- [ ] **Step 7: Inspect generated screenshots**

Open the three screenshots with the local image viewer and verify that canvases are nonblank, text fits, controls do not overlap, navigation is usable, and mobile content remains within the viewport.

- [ ] **Step 8: Document operation and security boundaries**

The README must include `npm install`, `npm run dev`, `npm test`, `npm run test:e2e`, manual two-window setup for the two real scenarios, session-only credential behavior, the absence of bundled secrets, and the explicit note that RTC media is not connected in this release.

- [ ] **Step 9: Start the development server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite reports a local URL. Keep the server running and provide that URL to the user.

