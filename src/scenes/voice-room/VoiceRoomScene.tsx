import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  CircleX,
  ChevronLeft,
  Copy,
  Crown,
  DoorOpen,
  Link2,
  LockKeyhole,
  Mic,
  MicOff,
  Radio,
  Search,
  Send,
  Sparkles,
  Unplug,
  Users,
  Volume2,
  X,
} from "lucide-react";

import type { ResolvedEnv } from "../../app/env";
import type { RtcHelper } from "../../shared/rtc";
import type { TraceSource } from "../../shared/timeline/useMergedTraces";
import {
  createBrowserRoomDirectory,
  directoryStorageKey,
  type StorageLike,
} from "./browser-room-directory";
import { SEAT_COUNT } from "./config";
import { AppRtmSession } from "./app-rtm";
import { SingleRoomClient } from "./event-driven-single-room-client";
import { RoomEntryController } from "./room-entry-controller";
import {
  createVoiceRoomInviteCode,
  createVoiceRoomUrl,
  parseVoiceRoomUrl as parseVoiceRoomDataUrl,
  type VoiceRoomUrlPayload,
} from "./voice-room-url";

export interface VoiceRoomSceneProps {
  env: Extract<ResolvedEnv, { configured: true }>;
  search?: string;
  overrides?: {
    createAppRtmSession?: (appId: string, userId: string) => AppRtmSession;
    createRtc?: () => RtcHelper;
    storage?: StorageLike;
  };
  onTraceSources?: (sources: readonly TraceSource[]) => void;
}

export const parseVoiceRoomUrl = parseVoiceRoomDataUrl;

function VoiceRoomToast({
  message,
  tone = "default",
  placement = "header",
}: {
  message: string | undefined;
  tone?: "default" | "error";
  placement?: "header" | "page";
}) {
  if (!message) return null;
  return (
    <div
      className={`vr-toast-viewport vr-toast-viewport--${placement}`}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <p
        className={`vr-toast-message ${tone === "error" ? "vr-toast--error" : "vr-room-toast"}`}
        role={tone === "error" ? "alert" : "status"}
      >
        {tone === "error" && <CircleX size={16} aria-hidden="true" />}
        <span>{message}</span>
      </p>
    </div>
  );
}

function SearchableAudienceSelect({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";
  const filtered = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <div
      ref={rootRef}
      className="vr-audience-select"
      data-open={open}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Search size={14} aria-hidden="true" />
      <input
        role="combobox"
        aria-label="选择邀请听众"
        aria-expanded={open}
        aria-controls="vr-audience-options"
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="搜索在线听众"
        value={open ? query : selectedLabel}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange("");
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      <ChevronDown size={14} aria-hidden="true" />
      {open && (
        <div id="vr-audience-options" className="vr-audience-select__options" role="listbox">
          {filtered.length === 0 ? (
            <p>没有匹配的在线听众</p>
          ) : (
            filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-label={option.label}
                aria-selected={option.value === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setQuery(option.label);
                  setOpen(false);
                }}
              >
                <span>{option.label.slice(0, 1)}</span>
                <strong>{option.label}</strong>
                {option.value === value && <Check size={14} aria-hidden="true" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** @deprecated 仅供旧测试迁移；新入房流程由 RoomEntryController generation 守卫。 */
export function createDirectEntryStartGuard() {
  let lastKey: string | undefined;
  return {
    claim(entry: { role: string; roomId: string; userId?: string }): boolean {
      const key = `${entry.role}:${entry.roomId}:${entry.userId ?? ""}`;
      if (lastKey === key) return false;
      lastKey = key;
      return true;
    },
  };
}

function randomId(prefix: string): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

function browserStorage(): StorageLike {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
    keys: () =>
      Array.from({ length: window.localStorage.length }, (_, index) =>
        window.localStorage.key(index),
      ).filter((key): key is string => Boolean(key)),
  };
}

type InviteCopyResult = "url" | "data" | false;

function copyTextWithLegacyCommand(text: string): boolean {
  if (!text) return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const legacyDocument = document as Document & { execCommand?: (command: string) => boolean };
    return legacyDocument.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function copyInvite(fullUrl: string, data: string): Promise<InviteCopyResult> {
  if (!fullUrl || !data) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(fullUrl);
      return "url";
    }
  } catch {
    // Clipboard API 不可用或权限拒绝时降级为短邀请内容。
  }
  return copyTextWithLegacyCommand(data) ? "data" : false;
}

function createE2eRtc(): RtcHelper {
  const noop = async () => undefined;
  return {
    registerEvents: () => undefined,
    join: noop,
    leave: noop,
    publishMicrophone: noop,
    unpublishMicrophone: noop,
    setMicrophoneMuted: noop,
    isMicrophoneCaptureHealthy: () => true,
    publishCamera: noop,
    unpublishCamera: noop,
    setCameraMuted: noop,
    getLocalVideoTrack: () => undefined,
  };
}

function traceSource(client: SingleRoomClient): TraceSource {
  return {
    getEntries: () => client.getTraces(),
    subscribe: (listener) => client.subscribeTraces(listener),
    clear: () => client.clearTraces(),
  };
}

function appTraceSource(session: AppRtmSession): TraceSource {
  return {
    getEntries: () => session.getTraces(),
    subscribe: (listener) => session.subscribeTraces(listener),
    clear: () => session.clearTraces(),
  };
}

const CHAT_EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "🙂",
  "🙃", "😉", "😍", "🥰", "😘", "😋", "😎", "🤓", "🧐", "🤩",
  "🥳", "😏", "😒", "😔", "😢", "😭", "😤", "😡", "🤯", "😱",
  "🥺", "😴", "🤒", "🤔", "🤭", "🤫", "🙄", "😬", "😇", "🤗",
  "👍", "👎", "👏", "🙌", "🤝", "🙏", "💪", "✌️", "🤞", "👌",
  "👋", "🤟", "🤙", "💖", "💕", "💔", "❤️", "🧡", "💛", "💚",
  "💙", "💜", "🔥", "✨", "🎉", "🎁", "🌹", "☕", "🎵", "💯",
] as const;

function VoiceRoomEnded({ message }: { message: string }) {
  return (
    <section className="vr-entry vr-entry--status" data-testid="voice-room-ended">
      <span className="vr-entry__status-icon"><CircleX size={24} aria-hidden="true" /></span>
      <h2>{message}</h2>
      <p>该房间已经结束，请通过新的邀请内容加入其他房间。</p>
    </section>
  );
}

function RoomSurface({
  client,
  getInvite,
  onLeave,
  onDissolve,
}: {
  client: SingleRoomClient;
  getInvite: () => { fullUrl: string; data: string };
  onLeave: () => void;
  onDissolve: () => void;
}) {
  const view = useSyncExternalStore(
    (listener) => client.subscribe(listener),
    () => client.getView(),
  );
  const [selectedSeatId, setSelectedSeatId] = useState("seat-1");
  const [chat, setChat] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [inviteUserId, setInviteUserId] = useState("");
  const [transientError, setTransientError] = useState<string>();
  const [transientNotice, setTransientNotice] = useState<string>();
  const [roomToast, setRoomToast] = useState<string>();
  const chatFeedRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const snapshot = view.snapshot;
  const isHost = view.role === "host";
  const hasOwnSeat = Boolean(
    Object.values(view.snapshot?.seats ?? {}).some(
      (seat) => seat.userId === view.userId,
    ),
  );
  const invite = getInvite();
  const roomTitle = view.roomName;
  const roomAnnouncement = snapshot?.announcement.trim() || "暂无公告";
  // 入房到收到权威 Storage 快照之间也保留完整麦位布局；这只是展示占位，不进 store。
  const seats = Object.values(snapshot?.seats ?? {});
  const displayedSeats = (
    seats.length > 0
      ? seats
      : Array.from({ length: SEAT_COUNT }, (_, index) => ({
          seatId: `seat-${index}`,
          userId: null,
          displayName: null,
        }))
  ).map((seat) => ({
    ...seat,
    displayName: seat.userId ? client.getMemberDisplayName(seat.userId) : null,
    status: seat.userId ? "active" as const : "empty" as const,
  }));
  const memberName = (userId: string) => client.getMemberDisplayName(userId);
  const audienceUserIds = view.onlineUsers.filter((userId) => userId !== view.userId);

  useEffect(() => {
    if (!view.error) return;
    setTransientError(view.error);
    const timer = window.setTimeout(() => setTransientError(undefined), 3_000);
    return () => window.clearTimeout(timer);
  }, [view.errorVersion]);

  useEffect(() => {
    if (!view.notice) return;
    setTransientNotice(view.notice);
    const timer = window.setTimeout(() => setTransientNotice(undefined), 3_000);
    return () => window.clearTimeout(timer);
  }, [view.noticeVersion]);

  useEffect(() => {
    if (!roomToast) return;
    const timer = window.setTimeout(() => setRoomToast(undefined), 3_000);
    return () => window.clearTimeout(timer);
  }, [roomToast]);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!emojiPickerRef.current?.contains(event.target as Node)) setShowEmojiPicker(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowEmojiPicker(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showEmojiPicker]);

  const insertEmoji = (emoji: string) => {
    const input = chatInputRef.current;
    const start = input?.selectionStart ?? chat.length;
    const end = input?.selectionEnd ?? start;
    const next = `${chat.slice(0, start)}${emoji}${chat.slice(end)}`;
    const caret = start + emoji.length;
    setChat(next);
    queueMicrotask(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  };

  useLayoutEffect(() => {
    const feed = chatFeedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [view.interactions]);

  useLayoutEffect(() => {
    const feed = chatFeedRef.current;
    if (feed && view.invitation) feed.scrollTop = 0;
  }, [view.invitation?.id]);

  if (view.endedReason) return <VoiceRoomEnded message={view.endedReason} />;
  return (
    <section
      className="vr-single"
      data-role={view.role}
      aria-label={isHost ? "房主语聊房" : "听众语聊房"}
    >
      <header className="vr-single__header">
        <h2 className="vr-single__visually-hidden">{roomTitle}</h2>
        <div className="vr-single__identity">
          <span className="vr-single__role-icon">
            {isHost ? (
              <Crown size={15} aria-hidden="true" />
            ) : (
              <Users size={15} aria-hidden="true" />
            )}
          </span>
          <div className="vr-single__identity-copy">
            <div className="vr-single__identity-meta">
              <span className="vr-single__role-label">
                {isHost ? "房主视角" : "听众视角"}
              </span>
              {!isHost && (
                <span className="vr-single__nickname">{view.displayName}</span>
              )}
            </div>
            <div className="vr-single__identity-main">
              <strong className="vr-single__identity-title">{roomTitle}</strong>
              <span
                className="vr-single__identity-announcement"
                title={roomAnnouncement}
              >
                {roomAnnouncement}
              </span>
            </div>
          </div>
        </div>
        <div className="vr-single__header-actions">
          {isHost && (
            <button
              type="button"
              className="vr-single__invite"
              aria-label="复制观众邀请链接"
              title="复制观众邀请链接"
              onClick={() => {
                void copyInvite(invite.fullUrl, invite.data).then((copied) => {
                  setRoomToast(copied === "url"
                    ? "已复制完整邀请链接"
                    : copied === "data"
                      ? "已复制短邀请内容"
                      : "复制失败，请检查浏览器剪贴板权限");
                });
              }}
            >
              <Copy size={14} aria-hidden="true" />
              <span>邀请好友</span>
            </button>
          )}
          <button
            type="button"
            className="vr-single__leave"
            title={isHost ? "暂时离开" : "退出房间"}
            aria-label={isHost ? "暂时离开" : "退出房间"}
            onClick={onLeave}
          >
            <DoorOpen size={16} aria-hidden="true" />
            <span>{isHost ? "暂时离开" : "退出"}</span>
          </button>
          {isHost && (
            <button
              type="button"
              className="vr-single__leave vr-single__leave--danger"
              title="解散房间"
              aria-label="解散房间"
              onClick={onDissolve}
            >
              <CircleX size={16} aria-hidden="true" />
              <span>解散</span>
            </button>
          )}
        </div>
      </header>
      <div className="vr-single__state">
        <span className="vr-single__connection" data-state={view.linkState}>
          <i aria-hidden="true" />
          <span>房间连接状态：</span>
          <strong>{view.linkState}</strong>
        </span>
      </div>
      <VoiceRoomToast
        message={transientError ?? transientNotice ?? roomToast}
        tone={transientError ? "error" : "default"}
      />
      <section className="vr-single__seats" aria-label="麦位">
        <div className="vr-single__section-heading">
          <div>
            <span>{isHost ? "麦位管理" : "房间麦位"}</span>
            <strong>
              {
                Object.values(snapshot?.seats ?? {}).filter(
                  (seat) => seat.userId !== null,
                ).length
              }
              /8
            </strong>
          </div>
          <small>
            {view.onlineUsers.length} 人在线 · {isHost ? "选择麦位管理嘉宾" : "选择空麦位申请上麦"}
          </small>
        </div>
        {displayedSeats.map((seat) => {
          const forcedMuted = Boolean(
            seat.userId && snapshot?.forcedMutedUserIds.includes(seat.userId),
          );
          const voluntarilyMuted = Boolean(
            seat.userId && view.memberMuted[seat.userId],
          );
          const muted = forcedMuted || voluntarilyMuted;
          const microphoneError = Boolean(
            seat.userId && view.memberMicrophoneErrors[seat.userId],
          );
          const hostAway = Boolean(
            seat.userId === snapshot?.hostUserId && view.hostTemporarilyAway,
          );
          const isSpeaking = Boolean(
            seat.userId &&
              seat.status === "active" &&
              !muted &&
              !microphoneError &&
              !hostAway &&
              (view.volumes[seat.userId] ?? 0) >= 35,
          );
          return (
            <button
              key={seat.seatId}
              type="button"
              className="vr-single__seat"
              data-selected={selectedSeatId === seat.seatId}
              data-state={seat.status}
              data-muted={muted}
              data-forced-muted={forcedMuted}
              data-microphone-error={microphoneError}
              data-host-away={hostAway}
              data-speaking={isSpeaking}
              onClick={() => setSelectedSeatId(seat.seatId)}
            >
              <span className="vr-single__seat-number">
                {Number(seat.seatId.replace("seat-", "")) + 1}
              </span>
              <span className="vr-single__seat-avatar" aria-hidden="true">
                {seat.displayName?.slice(0, 1) ?? "+"}
              </span>
              <strong>{seat.displayName ?? "空麦位"}</strong>
              <small>
                {seat.status === "active"
                  ? hostAway
                    ? "暂时离开…"
                    : microphoneError
                    ? "麦克风异常"
                    : isSpeaking
                    ? "正在说话"
                    : forcedMuted
                    ? "强制静音"
                    : voluntarilyMuted
                    ? "已闭麦"
                    : "已开麦"
                  : "可申请"}
              </small>
              {seat.status === "active" && (
                <span
                  className="vr-single__seat-mic"
                  title={
                    hostAway
                      ? "房主暂时离开"
                      : microphoneError
                      ? "麦克风设备异常"
                      : forcedMuted
                      ? "已被强制静音"
                      : voluntarilyMuted
                      ? "已闭麦"
                      : isSpeaking
                      ? "正在说话"
                      : "麦克风已开"
                  }
                >
                  {hostAway ? (
                    <DoorOpen size={14} aria-hidden="true" />
                  ) : microphoneError ? (
                    <Unplug size={14} aria-hidden="true" />
                  ) : muted ? (
                    <MicOff size={14} aria-hidden="true" />
                  ) : isSpeaking ? (
                    <AudioLines size={14} aria-hidden="true" />
                  ) : (
                    <Mic size={14} aria-hidden="true" />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </section>
      {isHost ? (
        <section className="vr-single__panel" aria-label="房间控制台">
          <div className="vr-single__panel-title">
            <div>
              <h3>房间管理</h3>
              <span>公告、排麦与成员治理</span>
            </div>
            <span className="vr-single__count">{view.queue.length} 个申请</span>
          </div>
          <div className="vr-single__control-group">
            <label className="vr-single__field">
              <span>房间公告</span>
              <div>
                <input
                  placeholder="写一句欢迎语…"
                  value={announcement}
                  onChange={(event) => setAnnouncement(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => void client.updateAnnouncement(announcement)}
                >
                  发布
                </button>
              </div>
            </label>
          </div>
          <div className="vr-single__control-group">
            <label className="vr-single__field">
              <span>邀请听众</span>
              <div>
                <SearchableAudienceSelect
                  value={inviteUserId}
                  onChange={setInviteUserId}
                  options={audienceUserIds.map((userId) => ({
                    value: userId,
                    label: memberName(userId),
                  }))}
                />
                <button
                  type="button"
                  disabled={!inviteUserId.trim()}
                  onClick={() =>
                    void client.invite(inviteUserId.trim(), selectedSeatId)
                  }
                >
                  邀请
                </button>
              </div>
            </label>
          </div>
          <div className="vr-single__control-group">
              <div className="vr-single__control-heading">
                <span>排麦申请</span>
                <small>{view.queue.length} 人等待</small>
            </div>
            <div className="vr-single__request-list">
              {view.queue.length === 0 ? (
                <div className="vr-single__empty">
                  <Sparkles size={18} aria-hidden="true" />
                  <p>暂时没有排麦申请</p>
                  <small>有人申请后会显示在这里</small>
                </div>
              ) : (
                view.queue.map((request) => (
                  <article key={request.id} className="vr-single__request">
                    <span className="vr-single__request-avatar">
                      {request.displayName.slice(0, 1)}
                    </span>
                    <div>
                      <strong>{request.displayName}</strong>
                      <small>
                        申请 {Number(request.seatId.replace("seat-", "")) + 1}{" "}
                        号麦位 · 剩余 {request.remainingSeconds} 秒
                      </small>
                    </div>
                    <div className="vr-single__request-actions">
                      <button
                        type="button"
                        aria-label={`同意${request.displayName}上麦`}
                        onClick={() => void client.approveSeatRequest(request.id)}
                      >
                        <Check size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`拒绝${request.displayName}上麦`}
                        onClick={() => void client.rejectSeatRequest(request.id)}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
          {snapshot?.seats[selectedSeatId]?.userId &&
            snapshot.seats[selectedSeatId].userId !== view.userId && (
              <div className="vr-single__member-actions">
                <span>
                  已选择 {memberName(snapshot.seats[selectedSeatId].userId!)}
                  {" · "}{Number(selectedSeatId.replace("seat-", "")) + 1} 号麦位
                </span>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      void client.forceMute(
                        snapshot.seats[selectedSeatId].userId!,
                        !snapshot.forcedMutedUserIds.includes(
                          snapshot.seats[selectedSeatId].userId!,
                        ),
                      )
                    }
                  >
                    {snapshot.forcedMutedUserIds.includes(
                      snapshot.seats[selectedSeatId].userId!,
                    )
                      ? "解除静音"
                      : "静音"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void client.forceLeave(
                        snapshot.seats[selectedSeatId].userId!,
                      )
                    }
                  >
                    下麦
                  </button>
                </div>
              </div>
            )}
          <div className="vr-single__control-group vr-single__members-group">
            <section className="vr-single__member-list" aria-label="房间成员管理">
              <div className="vr-single__control-heading">
                <span>在线观众</span>
                <small>{Math.max(0, view.onlineUsers.length - 1)} 人</small>
              </div>
              {audienceUserIds.map((userId) => (
                <article key={userId} className="vr-single__member-row">
                  <strong>{memberName(userId)}</strong>
                  <span className="vr-single__member-row-actions">
                    <button type="button" aria-label={`踢出${memberName(userId)}`} onClick={() => void client.kickMember(userId)}>踢出</button>
                    <button type="button" aria-label={`封禁${memberName(userId)}`} className="vr-single__danger" onClick={() => void client.banMember(userId)}>封禁</button>
                  </span>
                </article>
              ))}
            </section>
          </div>
        </section>
      ) : null}
      <section className="vr-single__chat" aria-label="互动消息">
        <div className="vr-single__chat-feed" ref={chatFeedRef} data-testid="voice-room-chat-feed">
          {!isHost && view.invitation && (
            <div className="vr-single__inline-invitation" role="status">
              <span>房主邀请你上 {Number(view.invitation.seatId.replace("seat-", "")) + 1} 号麦</span>
              <button type="button" onClick={() => void client.acceptInvitation()}>接受</button>
              <button type="button" onClick={() => void client.rejectInvitation()}>拒绝</button>
            </div>
          )}
          {view.interactions.length === 0 ? (
            <p className="vr-single__chat-empty">和大家打个招呼，开始互动吧</p>
          ) : (
            view.interactions.map((item) => (
              <p
                key={item.id}
                className={item.type.startsWith("system-") ? "vr-single__system-message" : undefined}
                data-interaction-type={item.type}
              >
                {item.type.startsWith("system-") ? (
                  <span>{item.value}</span>
                ) : (
                  <>
                    <strong>{item.displayName}</strong>
                    <span>
                      {item.type === "gift"
                        ? ` 送出礼物 ${item.value}`
                        : item.type === "emoji"
                          ? ` 送出爱心 ${item.value}`
                          : ` ${item.value}`}
                    </span>
                  </>
                )}
              </p>
            ))
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void client
              .sendInteraction("chat.message", chat)
              .then(() => setChat(""));
          }}
        >
          <div className="vr-single__emoji-control" ref={emojiPickerRef}>
            <button
              type="button"
              className="vr-single__quick-action"
              aria-label={showEmojiPicker ? "关闭 Emoji 选择器" : "打开 Emoji 选择器"}
              aria-expanded={showEmojiPicker}
              title="Emoji"
              onClick={() => setShowEmojiPicker((visible) => !visible)}
            >
              😊
            </button>
            {showEmojiPicker && (
              <div className="vr-single__emoji-picker" role="dialog" aria-label="Emoji 选择器">
                {CHAT_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`插入 ${emoji}`}
                    title={emoji}
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="vr-single__quick-action"
            aria-label="发送礼物消息"
            title="发送礼物消息"
            onClick={() => void client.sendInteraction("gift.sent", "🎁")}
          >
            🎁
          </button>
          <button
            type="button"
            className="vr-single__quick-action"
            aria-label="发送爱心消息"
            title="发送爱心消息"
            onClick={() => void client.sendInteraction("emoji.reaction", "❤️")}
          >
            ❤️
          </button>
          <input
            ref={chatInputRef}
            aria-label="聊天内容"
            placeholder="说点什么…"
            value={chat}
            onChange={(event) => setChat(event.target.value)}
          />
          <button type="submit" aria-label="发送聊天" disabled={!chat.trim()}>
            <Send size={15} aria-hidden="true" />
          </button>
          {hasOwnSeat && (
            <button
              type="button"
              className="vr-single__mic-action"
              disabled={Boolean(snapshot?.forcedMutedUserIds.includes(view.userId))}
              onClick={() => void client.setOwnMuted(!view.ownMuted)}
            >
              {snapshot?.forcedMutedUserIds.includes(view.userId)
                ? "已被静音"
                : view.ownMuted ? "开麦" : "闭麦"}
            </button>
          )}
          {!isHost && (
              <button
                type="button"
                className="vr-single__seat-action"
                disabled={Boolean(view.waitingSeatId) || (!hasOwnSeat && view.hostTemporarilyAway)}
                title={!hasOwnSeat && view.hostTemporarilyAway
                  ? "房主暂时离开，无法处理上麦申请"
                  : undefined}
                onClick={() => {
                  if (hasOwnSeat) void client.leaveSeat();
                  else void client.requestSeat(selectedSeatId);
                }}
              >
                {hasOwnSeat ? "主动下麦" : view.waitingSeatId ? "等待审批" : "申请上麦"}
              </button>
          )}
        </form>
      </section>
    </section>
  );
}

/* 迁移期保留的旧页面实现；48 号票在新路径全量验收后清理。
export function LegacyVoiceRoomScene({
  env,
  search = window.location.search,
  onTraceSources,
}: VoiceRoomSceneProps) {
  const directEntry = useMemo(() => parseVoiceRoomUrl(search), [search]);
  const invitedRoom = directEntry?.roomId;
  const directAudience = directEntry?.role === "audience";
  const directHost = directEntry?.role === "host";
  const [mode, setMode] = useState<EntryMode>(
    directAudience || directHost ? "loading" : "choose",
  );
  const [roomId, setRoomId] = useState(invitedRoom ?? "");
  const [title, setTitle] = useState("");
  const [createAnnouncement, setCreateAnnouncement] = useState("");
  const [session, setSession] = useState<SingleRoomClient>();
  const [toast, setToast] = useState<string>();
  const [endedMessage, setEndedMessage] = useState<string>();
  const [appRtm] = useState(() => new AppRtmSession(env.appId, directEntry?.userId ?? randomId("user")));
  const [appRtmReady, setAppRtmReady] = useState(false);
  const directory = useMemo(
    () => createBrowserRoomDirectory(browserStorage()),
    [],
  );
  const directEntryStartGuard = useRef(createDirectEntryStartGuard());
  const entries = directory.list();

  useEffect(() => {
    let active = true;
    void appRtm.login().then(() => { if (active) setAppRtmReady(true); }).catch((error) => { if (active) setToast(error instanceof Error ? error.message : "RTM 登录失败"); });
    // StrictMode probes mount/cleanup/mount; logging out here would disconnect the
    // app client reused by the second mount. The real page unmount owns final logout.
    return () => { active = false; };
  }, [appRtm]);

  const start = useCallback(
    async (
      role: SingleRoomRole,
      targetRoomId: string,
      roomTitle = "语聊房",
      hostMode: "create" | "rejoin" = "create",
      initialUserId?: string,
      initialAnnouncement?: string,
      invite?: VoiceRoomUrlState,
    ) => {
      if (!appRtmReady) { setToast("RTM 正在登录，请稍候"); return; }
      if (role === "audience" && invite?.hostUserId) {
        directory.upsert({ roomId: targetRoomId, roomName: invite.roomName ?? roomTitle, hostUserId: invite.hostUserId, banUserIds: invite.banUserIds ?? [], updatedAt: invite.updatedAt });
      }
      let userId = appRtm.userId;
      const createClient = (effectiveUserId: string) => {
        const localRoom = directory
          .list()
          .find((entry) => entry.roomId === targetRoomId);
        return new SingleRoomClient({
          appId: env.appId,
          role,
          roomId: targetRoomId,
          roomName: roomTitle,
          userId: effectiveUserId,
          displayName: role === "host" ? "Host" : "Audience",
          hostMode,
          directory,
          expectedHostUserId: localRoom?.hostUserId,
          locallyBannedUserIds: localRoom?.banUserIds,
          onAudienceAdmission: role === "audience" ? () => setMode("room") : undefined,
          onRoomSubscribed: role === "host" ? () => setMode("room") : undefined,
          createRtmClient: () => appRtm.getClient()!,
          alreadyLoggedIn: true,
        });
      };
      let client = createClient(userId);
      setSession(client);
      setMode("loading");
      try {
        await client.connect(roomTitle);
        if (role === "host")
          directory.upsert({
            roomId: targetRoomId,
            roomName: roomTitle,
            hostUserId: userId,
            banUserIds: [],
            updatedAt: Date.now(),
          });
        if (
          role === "host" &&
          hostMode === "create" &&
          initialAnnouncement?.trim()
        )
          await client.updateAnnouncement(initialAnnouncement);
        replaceRoomUrl(targetRoomId, role, userId);
        setMode("room");
      } catch (error) {
        if (
          role === "host" &&
          hostMode === "rejoin" &&
          error instanceof HostIdentityMismatchError
        ) {
          await client.stop();
          userId = error.hostUserId;
          client = createClient(userId);
          setSession(client);
          await client.connect(roomTitle);
          replaceRoomUrl(targetRoomId, role, userId);
          return;
        }
        const message = error instanceof Error ? error.message : "加入房间失败";
        if (message === "房主已离开，房间结束" || message === "你已被该房间封禁") {
          setSession(undefined);
          setEndedMessage(message);
          setMode("expired");
        } else setToast(message);
      }
    },
    [directory, env.appId, appRtm, appRtmReady],
  );

  useEffect(() => {
    if ((!directAudience && !directHost) || !invitedRoom || session || !appRtmReady) return;
    const role: SingleRoomRole = directHost ? "host" : "audience";
    if (!directEntry || !directEntryStartGuard.current.claim(directEntry))
      return;
    const entry = entries.find((item) => item.roomId === invitedRoom);
    const roomName = directEntry.roomName ?? entry?.roomName ?? "语聊房";
    void start(
      role,
      invitedRoom,
      roomName,
      directHost ? "rejoin" : "create",
      directEntry?.userId,
      undefined,
      directEntry,
    );
  }, [
    directAudience,
    directEntry,
    directHost,
    entries,
    invitedRoom,
    appRtmReady,
    session,
    start,
  ]);

  useEffect(() => {
    if (!session) return;
    onTraceSources?.([traceSource(session)]);
    return () => onTraceSources?.([]);
  }, [onTraceSources, session]);

  useEffect(() => {
    if (!session || mode !== "room") return;
    let timeout: number;
    const arm = () => {
      timeout = window.setTimeout(() => {
        void session.stop().finally(() => setMode("expired"));
      }, 5 * 60 * 1000);
    };
    const reset = () => {
      window.clearTimeout(timeout);
      arm();
    };
    arm();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    window.addEventListener("touchstart", reset);
    window.addEventListener("input", reset);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("touchstart", reset);
      window.removeEventListener("input", reset);
    };
  }, [mode, session]);

  useEffect(
    () => () => {
      void session?.stop();
    },
    [session],
  );

  if (mode === "expired")
    return (
      <section
        className="vr-entry vr-entry--status"
        data-testid="voice-room-expired"
      >
        <span className="vr-entry__status-icon">
          <LockKeyhole size={24} aria-hidden="true" />
        </span>
        <h2>{endedMessage ?? "本次体验已结束"}</h2>
        <p>{endedMessage ? "请通过新的邀请链接再次体验。" : "长时间无操作，刷新以再次体验。"}</p>
      </section>
    );
  if (mode === "loading")
    return <section className="vr-entry vr-entry--status" aria-live="polite" data-testid="voice-room-loading"><span className="vr-entry__status-icon"><Radio size={24} aria-hidden="true" /></span><h2>{toast ? "进入房间失败" : "正在进入房间…"}</h2><p>{toast ?? "正在校验房主状态并订阅房间数据。"}</p></section>;
  if (mode === "room" && session)
    return (
      <>
        <RoomSurface
          client={session}
          onLeave={() =>
            void session.stop().finally(() => {
              setSession(undefined);
              setMode("choose");
            })
          }
          onInviteCopied={() => setToast("已复制到剪贴板")}
        />
        {toast && (
          <p role="status" className="vr-toast">
            {toast}
          </p>
        )}
      </>
    );
  if (mode === "create")
    return (
      <section className="vr-entry vr-entry--form">
        <button
          type="button"
          className="vr-entry__back"
          onClick={() => { setRoomId(""); setMode("choose"); }}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          返回
        </button>
        <span className="vr-entry__kicker">
          <Crown size={14} aria-hidden="true" />
          HOST MODE
        </span>
        <h2>创建一间有温度的语聊房</h2>
        <p>创建后可邀请朋友进入，并实时管理麦位与公告。</p>
        <label>
          房间标题
          <input
            aria-label="房间标题"
            placeholder="例如：今晚的音乐分享会"
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          房间公告
          <input
            aria-label="房间公告"
            placeholder="例如：今晚一起分享喜欢的旋律和故事，欢迎上麦交流。"
            value={createAnnouncement}
            onChange={(event) => setCreateAnnouncement(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="vr-entry__primary"
          onClick={() =>
            void start(
              "host",
              randomId("voice-room"),
              title.trim() || "体验语聊房",
              "create",
              undefined,
              createAnnouncement,
            )
          }
        >
          创建并进入
        </button>
      </section>
    );
  if (mode === "join")
    return (
      <section className="vr-entry vr-entry--form">
        <button
          type="button"
          className="vr-entry__back"
          onClick={() => { setRoomId(""); setMode("choose"); }}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          返回
        </button>
        <span className="vr-entry__kicker">
          <Link2 size={14} aria-hidden="true" />
          JOIN A ROOM
        </span>
        <h2>加入正在发生的对话</h2>
        <p>请粘贴房主分享的完整邀请链接。</p>
        <label>
          邀请链接
          <input
            aria-label="邀请链接"
            placeholder="粘贴完整邀请链接"
            autoFocus
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="vr-entry__primary"
          disabled={!roomId.trim()}
          onClick={() => {
            try {
              const parsed = parseVoiceRoomUrl(new URL(roomId.trim()).search);
              if (!parsed || parsed.role !== "audience" || !parsed.hostUserId)
                throw new Error();
              void start(
                "audience",
                parsed.roomId,
                parsed.roomName ?? "体验语聊房",
                "create",
                parsed.userId,
                undefined,
                parsed,
              );
            } catch {
              setToast("请粘贴有效的邀请链接");
            }
          }}
        >
          加入房间
        </button>
        <div className="vr-entry__directory">
          <div>
            <strong>本机最近房间</strong>
            <span>{entries.length} 个</span>
          </div>
          {entries.length === 0 ? (
            <p>暂无本地房间，请粘贴邀请链接加入。</p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <li key={entry.roomId}>
                  <button
                    type="button"
                    onClick={() =>
                      void start(
                        "audience",
                        entry.roomId,
                        entry.roomName,
                      )
                    }
                  >
                    <span className="vr-entry__directory-mark">
                      <Volume2 size={15} aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{entry.roomName}</strong>
                      <small>点击直接加入</small>
                    </span>
                    <ChevronLeft size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  return (
    <section
      className="vr-entry vr-entry--landing"
      data-testid="voice-room-entry"
    >
      <div className="vr-entry__hero">
        <span className="vr-entry__hero-icon">
          <Volume2 size={22} aria-hidden="true" />
        </span>
        <span className="vr-entry__kicker">LIVE VOICE ROOM</span>
        <h1>在声音里，相遇</h1>
        <p>创建一间语聊房，或通过邀请链接加入一场正在发生的对话。</p>
      </div>
      <div className="vr-entry__choices">
        <button
          type="button"
          aria-label="作为房主开始"
          className="vr-entry__choice vr-entry__choice--host"
          onClick={() => setMode("create")}
        >
          <span>
            <Crown size={22} aria-hidden="true" />
          </span>
          <div>
            <strong>我是房主</strong>
            <small>创建房间，邀请朋友一起聊</small>
          </div>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="作为观众开始"
          className="vr-entry__choice"
          onClick={() => { setRoomId(""); setMode("join"); }}
        >
          <span>
            <Users size={22} aria-hidden="true" />
          </span>
          <div>
            <strong>我是听众</strong>
            <small>通过邀请链接加入</small>
          </div>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="vr-entry__footnote">
        进入房间后，使用耳机可获得更好的语音体验
      </p>
    </section>
  );
}
*/

export function VoiceRoomScene({
  env,
  search = window.location.search,
  overrides,
  onTraceSources,
}: VoiceRoomSceneProps) {
  const directPayload = useMemo(() => parseVoiceRoomDataUrl(search), [search]);
  const pageUid = directPayload?.pageUid ?? randomId("user");
  const [appRtm] = useState(() => overrides?.createAppRtmSession?.(env.appId, pageUid) ?? new AppRtmSession(env.appId, pageUid));
  const pageTraceSource = useMemo(() => appTraceSource(appRtm), [appRtm]);
  const accumulatedTraceSourcesRef = useRef<TraceSource[]>([pageTraceSource]);
  const clientTraceSourcesRef = useRef(new WeakMap<SingleRoomClient, TraceSource>());
  const onTraceSourcesRef = useRef(onTraceSources);
  onTraceSourcesRef.current = onTraceSources;
  const directory = useMemo(() => createBrowserRoomDirectory(overrides?.storage ?? browserStorage()), [overrides?.storage]);
  const [controller] = useState(() => new RoomEntryController({
    appId: env.appId,
    session: appRtm,
    directory,
    createRtc: overrides?.createRtc ?? (import.meta.env.MODE === "e2e" ? createE2eRtc : undefined),
    replaceUrl: (payload) => {
      const url = createVoiceRoomUrl(window.location.origin, payload);
      window.history.replaceState(null, "", new URL(url).pathname + new URL(url).search);
    },
  }));
  const entryView = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getView(),
  );
  const [bootState, setBootState] = useState<"booting" | "ready" | "error">("booting");
  const [bootError, setBootError] = useState<string>();
  const [loginAttempt, setLoginAttempt] = useState(0);
  const [roomName, setRoomName] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [toast, setToast] = useState<string>();
  const directStarted = useRef(false);
  const logoutTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setBootState("booting");
    setBootError(undefined);
    void appRtm.login().then(() => {
      if (active) setBootState("ready");
    }).catch((error) => {
      if (!active) return;
      setBootError(error instanceof Error ? error.message : "RTM 登录失败");
      setBootState("error");
    });
    return () => { active = false; };
  }, [loginAttempt, appRtm]);

  useEffect(() => {
    if (logoutTimer.current !== undefined) window.clearTimeout(logoutTimer.current);
    return () => {
      logoutTimer.current = window.setTimeout(() => { void appRtm.logout(); }, 0);
    };
  }, [appRtm]);

  useEffect(() => {
    if (bootState !== "ready" || !directPayload || directStarted.current) return;
    directStarted.current = true;
    const entering = directPayload.role === "audience"
      ? controller.joinAudienceFromUrlPayload(directPayload)
      : controller.restoreHostFromUrlPayload(directPayload);
    void entering.catch((error) => {
      setToast(error instanceof Error ? error.message : "加入房间失败");
    });
  }, [bootState, controller, directPayload]);

  const client = entryView.client;
  useEffect(() => {
    if (client && !clientTraceSourcesRef.current.has(client)) {
      const source = traceSource(client);
      clientTraceSourcesRef.current.set(client, source);
      accumulatedTraceSourcesRef.current.push(source);
    }
    onTraceSources?.([...accumulatedTraceSourcesRef.current]);
  }, [client, onTraceSources, pageTraceSource]);

  useEffect(() => () => onTraceSourcesRef.current?.([]), []);

  useEffect(() => {
    if (!client || entryView.phase !== "room") return;
    let timeout = 0;
    const arm = () => {
      timeout = window.setTimeout(() => {
        void client.leaveRoom("五分钟无操作，本次体验已结束");
      }, 5 * 60 * 1000);
    };
    const reset = () => { window.clearTimeout(timeout); arm(); };
    arm();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    window.addEventListener("touchstart", reset);
    window.addEventListener("input", reset);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("touchstart", reset);
      window.removeEventListener("input", reset);
    };
  }, [client, entryView.phase]);

  const inviteForCurrentRoom = () => {
    if (!client) return { fullUrl: "", data: "" };
    const entry = directory.get(client.getView().roomId) ?? entryView.entry;
    if (!entry) return { fullUrl: "", data: "" };
    const payload: VoiceRoomUrlPayload = {
      localStorage: { [directoryStorageKey(new Date(entry.createdAt))]: entry },
      role: "audience",
      pageUid: null,
      nickname: null,
    };
    return {
      fullUrl: createVoiceRoomUrl(window.location.origin, payload),
      data: createVoiceRoomInviteCode(payload),
    };
  };

  if (bootState === "booting" || (directPayload && entryView.phase === "admitting")) {
    return (
      <section className="vr-entry vr-entry--status" aria-live="polite" data-testid="voice-room-booting">
        <span className="vr-entry__status-icon"><Radio size={24} aria-hidden="true" /></span>
        <h2>{directPayload && bootState === "ready" ? "正在校验房主状态…" : "正在初始化 RTM…"}</h2>
        <p>完成登录后即可选择房主或听众流程。</p>
      </section>
    );
  }

  if (bootState === "error") {
    return (
      <section className="vr-entry vr-entry--status" data-testid="voice-room-boot-error">
        <span className="vr-entry__status-icon"><CircleX size={24} aria-hidden="true" /></span>
        <h2>RTM 登录失败</h2>
        <p>{bootError}</p>
        <button type="button" className="vr-entry__primary" onClick={() => setLoginAttempt((value) => value + 1)}>重新登录</button>
      </section>
    );
  }

  if (entryView.phase === "ended") {
    return <VoiceRoomEnded message={entryView.error ?? "房间已结束"} />;
  }

  if (client && (entryView.phase === "subscribing" || entryView.phase === "room")) {
    return (
      <section className="vr-room-stage">
        <RoomSurface
          client={client}
          getInvite={inviteForCurrentRoom}
          onLeave={() => { void controller.leaveRoom(); }}
          onDissolve={() => { void client.dissolveRoom(); }}
        />
        {entryView.phase === "subscribing" && (
          <div className="vr-room-loading" role="status" aria-live="polite" data-testid="voice-room-loading-overlay">
            <Radio size={24} aria-hidden="true" />
            <strong>正在加载房间…</strong>
          </div>
        )}
        <VoiceRoomToast message={toast} tone="error" />
      </section>
    );
  }

  const entries = directory.listForUser(appRtm.userId);
  const joinFromInput = () => {
    const payload = parseVoiceRoomDataUrl(inviteInput.trim());
    if (!payload || payload.role !== "audience") {
      setToast("请粘贴有效的 Audience 邀请链接");
      return;
    }
    void controller.joinAudienceFromUrlPayload(payload).catch((error) => {
      setToast(error instanceof Error ? error.message : "加入房间失败");
    });
  };

  return (
    <section className="vr-entry vr-entry--landing" data-testid="voice-room-entry">
      <div className="vr-entry__hero">
        <span className="vr-entry__hero-icon"><Volume2 size={22} aria-hidden="true" /></span>
        <span className="vr-entry__kicker">LIVE VOICE ROOM</span>
        <h1>在声音里，相遇</h1>
        <p>创建一间语聊房，或通过邀请链接加入一场正在发生的对话。</p>
      </div>
      <div className="vr-entry__choices">
        <section className="vr-entry__choice-panel vr-entry__choice--host">
          <span><Crown size={22} aria-hidden="true" /></span>
          <label>
            房间名称
            <input aria-label="房间标题" value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="例如：周五晚间语聊" />
          </label>
          <button type="button" className="vr-entry__primary" disabled={!roomName.trim()} onClick={() => {
            void controller.createHostRoom({ roomName }).catch((error) => setToast(error instanceof Error ? error.message : "创建房间失败"));
          }}>创建并进入</button>
        </section>
        <section className="vr-entry__choice-panel">
          <span><Link2 size={22} aria-hidden="true" /></span>
          <label>
            Audience 邀请链接
            <input aria-label="邀请链接" value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} placeholder="粘贴 data=... 邀请内容" />
          </label>
          <button type="button" className="vr-entry__primary" disabled={!inviteInput.trim()} onClick={joinFromInput}>加入房间</button>
        </section>
      </div>
      <div className="vr-entry__directory">
        <div><strong>本机最近房间</strong><span>{entries.length} 个</span></div>
        {entries.length === 0 ? <p>暂无可加入的本地房间。</p> : (
          <ul>{entries.map((entry) => (
            <li key={entry.roomId}>
              <button type="button" onClick={() => {
                void controller.joinAudienceFromDirectory(entry.roomId).catch((error) => setToast(error instanceof Error ? error.message : "加入房间失败"));
              }}>
                <span className="vr-entry__directory-mark"><Users size={15} aria-hidden="true" /></span>
                <span><strong>{entry.roomName}</strong><small>点击加入房间</small></span>
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
            </li>
          ))}</ul>
        )}
      </div>
      <VoiceRoomToast message={toast ?? entryView.error} tone="error" placement="page" />
      <p className="vr-entry__footnote">进入房间后，使用耳机可获得更好的语音体验</p>
    </section>
  );
}
