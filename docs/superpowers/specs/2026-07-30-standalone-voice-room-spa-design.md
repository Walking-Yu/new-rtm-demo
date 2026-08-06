# Standalone Voice Room SPA Design

## 1. Objective

Create a customer-copyable voice-room demo as a self-contained single-page application under `demos/voice-room/`. The demo combines `agora-rtm@2.2.4` with `agora-rtc-sdk-ng@latest` and demonstrates a complete social voice-room workflow with two real clients rendered in one browser page.

The root launcher and root development command open only this voice-room SPA on port 8080. Existing scenario-lab source remains in the repository but is not exposed by the default navigation, URL, or launcher. No existing scenario source is deleted.

## 2. Delivery Boundary

`demos/voice-room/` must be independently copyable and contain:

- Its own `package.json` and package lock.
- Vite, React, TypeScript, Vitest, Testing Library, and headless Playwright configuration.
- All domain, runtime, adapter, component, style, and test source required by the demo.
- A local `start-demo.sh` and a Chinese README.
- No imports from the repository root `src/` tree.

After copying only this directory, a customer can run `npm install` and `npm run dev` without the root project.

## 3. User Experience

### 3.1 Routes

- `/` renders the connection setup surface.
- `/room/:roomId` renders the live two-client workbench.
- Any unknown path returns to setup with a clear error.

The application is one client-rendered SPA. Each future business scenario should follow the same independent-folder pattern rather than being added to a shared scenario catalog.

### 3.2 Connection setup

The setup surface collects:

- Shared App ID and room ID.
- Host display name, User ID, RTM Token, and RTC Token.
- Audience display name, User ID, RTM Token, and RTC Token.

RTC and RTM use the same room ID and the same string User ID per endpoint. All fields are required. User IDs must be distinct. Values are stored only in the current tab's `sessionStorage`; no App Certificate is accepted or bundled.

Before connection, the UI warns that both real RTC clients run on the same machine, remote audio is always played, and headphones are required to avoid acoustic feedback.

### 3.3 Room workbench

Desktop displays host and audience clients side by side. Mobile uses a stable Host/Audience tab control. Both views are instances of a reusable `VoiceRoomClientView` with role-specific controls; the demo shell owns only layout and shared setup.

Each endpoint displays:

- RTM and RTC connection state separately.
- Room announcement and online member count.
- Eight stable seat positions.
- Request queue and pending invitation state.
- Public chat, emoji reactions, and gift events.
- Role-appropriate actions and operation feedback.
- A chronological event stream useful for learning the implementation.

## 4. Voice Room Workflows

### 4.1 Join and media

Both endpoints register RTM and RTC listeners before connecting. RTM login/subscription and snapshot hydration complete before room mutations are enabled. RTC joins the same room with the endpoint User ID.

The host occupies seat 0. After both transports connect, the host creates and publishes a real microphone audio track. The audience joins as a listener without a local track. Remote audio is automatically subscribed and played.

### 4.2 Request and approval

- Audience selects an empty seat and submits a request.
- The request is persisted in the room snapshot and announced through RTM.
- Audience can cancel while pending.
- Host can approve or reject a queued request.
- Approval reserves the seat as `joining` and sends a targeted command.
- Audience creates and publishes a microphone track.
- Only after RTC publish succeeds does the seat become `active` and display speaking state.
- Publish failure releases the reservation and records a visible error.

### 4.3 Host invitation

- Host selects an online audience member and empty seat, then sends an invitation.
- The pending invitation is persisted so reconnect can restore it.
- Audience accepts or rejects.
- Acceptance follows the same `joining -> RTC publish -> active` transition as approval.

### 4.4 Seat controls

- Audience can mute/unmute its own track and leave the seat.
- Host can request mute/unmute, force the audience off the seat, or cancel a pending transition.
- Track operations complete before the final room snapshot is committed.
- Leaving or forced removal unpublishes and closes the audience microphone track.

### 4.5 Social interaction

- Public chat, emoji, gift, and lightweight reaction events use RTM Message Channel messages.
- Chat history is session-only and is not represented as durable IM history.
- Host edits the room announcement through Storage.
- The UI distinguishes platform-send success from received and executed outcomes.

### 4.6 Governance

Host can mute, unmute, force off-seat, kick, and ban the audience client. The audience cooperatively executes targeted host commands. A ban list is persisted in Storage and the demo prevents a listed User ID from rejoining.

This is explicitly a client-side demonstration, not production authorization. The UI and README state that production governance requires a trusted business backend to authenticate the host, validate commands, and maintain authoritative bans.

## 5. RTM and RTC Responsibilities

### 5.1 RTM

- Message Channel carries request, invitation, approval, moderation, chat, emoji, gift, ACK, and media-ready events.
- Presence supplies online members and reconnect member recovery.
- Storage contains room profile, seats, queue, pending invitation, and ban state.
- Named Locks serialize queue, seat, and room-administration mutations.

The normalized message envelope contains `schemaVersion`, `messageId`, `type`, `roomId`, `senderId`, optional `targetId`, `sentAt`, `expiresAt`, `requiresAck`, and `payload`. Receivers validate schema, room, target, expiry, and duplicate `messageId` before acting.

### 5.2 RTC

- Each endpoint owns an independent RTC client.
- Host publishes its microphone after connection.
- Audience publishes only after seat approval or invitation acceptance.
- Both clients automatically subscribe to and play remote audio.
- Local mute state is applied to the microphone track and reflected in RTM Storage.
- RTC leave closes all local tracks and removes media listeners.

## 6. State and Consistency

The room snapshot contains:

```ts
interface VoiceRoomSnapshot {
  revision: number;
  hostUserId: string;
  announcement: string;
  seats: Record<string, SeatState>;
  queue: SeatRequest[];
  invitation: SeatInvitation | null;
  bannedUserIds: string[];
}
```

Seat status is `empty`, `joining`, `active`, or `muted`. Snapshot mutations acquire the relevant named Lock, re-read Storage, apply a pure domain transition, write the next revision, and release in `finally`. Lock conflict refreshes the latest snapshot rather than overwriting another client.

On RTM reconnection, a client resubscribes, reloads Presence and Storage, reconciles its RTC publication against the snapshot, and then re-enables controls. The last valid snapshot stays visible during recovery.

## 7. Module Boundaries

- `domain/`: pure types, commands, transition functions, protocol validation, and deduplication.
- `runtime/ports/`: SDK-independent RTM and RTC interfaces.
- `runtime/agora/`: the only modules importing Agora SDKs.
- `runtime/VoiceRoomClient.ts`: one endpoint's orchestration and lifecycle.
- `app/`: setup persistence, routing, and dual-client composition.
- `components/`: reusable endpoint, seat, queue, interaction, timeline, and dialog views.

The dual-client shell depends on the endpoint runtime interface rather than Agora SDK objects. A customer can mount one endpoint view and runtime without the second demo endpoint.

## 8. Error Handling

The UI exposes actionable Chinese errors for missing fields, duplicate User IDs, invalid or expired tokens, RTM/RTC connection failure, microphone permission denial, publish/subscribe failure, Storage/Lock conflict, command timeout, banned join, and reconnect failure.

Async action failures are caught by the endpoint runtime and appended to the endpoint event stream. No operation creates an unhandled promise rejection. Cleanup is idempotent and runs on disconnect, route exit, and component unmount.

## 9. Testing

Implementation follows vertical TDD slices.

- Domain tests cover protocol validation, deduplication, request/approval/invitation transitions, seat rollback, mute, leave, kick, ban, and snapshot revisions.
- Runtime contract tests use in-memory RTM and RTC ports to verify listener registration, connect order, RTC publish before active-seat commit, ACK handling, Lock release, reconnect hydration, and cleanup.
- Component tests cover required setup fields, distinct User IDs, session-only credentials, two endpoint panels, role permissions, queue/invitation controls, and mobile tabs.
- Headless Playwright covers setup validation, routing, responsive layout, and console/page-error absence without requiring real credentials.
- Manual verification with valid credentials covers two RTM clients, two RTC clients, real microphone publication, remote subscription/playback, approval, invitation, moderation, reconnect, and headphones warning.

## 10. Security and Product Boundaries

- Tokens are pasted manually and remain in `sessionStorage` only.
- No App Certificate, customer credential, fallback token, or token generator is included.
- Chat has no offline history, unread count, push, or complete IM semantics.
- Governance is cooperative and not secure against a modified client.
- Storage is a room snapshot, not a durable business database.
- The demo requires headphones because remote audio always plays from two clients on one machine.

## 11. Acceptance Criteria

- Root startup opens only the voice-room SPA at `http://127.0.0.1:8080/`.
- `demos/voice-room/` runs after being copied independently.
- Host and audience real clients can connect from one page using manual RTM/RTC tokens.
- All requested seat, invitation, media, social, announcement, and governance workflows are implemented.
- RTC publish success gates active seat state; failure rolls it back.
- Other scenario pages are inaccessible from the default application while their source remains untouched.
- Unit, component, build, and headless browser tests pass.
- Desktop and mobile screenshots show nonblank, nonoverlapping interfaces.
