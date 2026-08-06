import { ArrowLeft, Headphones, PlugZap, Radio, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { HeadphonesWarning } from '../components/HeadphonesWarning';
import { VoiceRoomClientView } from '../components/VoiceRoomClientView';
import { createInitialSnapshot } from '../domain/transitions';
import type { EndpointRole, VoiceRoomSnapshot } from '../domain/types';
import type {
  EndpointSettings,
  VoiceRoomClientState,
  VoiceRoomCommand,
} from '../runtime/VoiceRoomClient';
import { loadConnectionSettings, type EndpointConnectionSettings } from './connectionSettings';

export interface RoomClientLike {
  getState(): VoiceRoomClientState;
  subscribe(listener: (state: VoiceRoomClientState) => void): () => void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  execute(command: VoiceRoomCommand): Promise<void>;
  destroy(): void;
}

export type RoomClientFactory = (
  role: EndpointRole,
  settings: EndpointSettings,
  initialSnapshot: VoiceRoomSnapshot,
) => RoomClientLike | Promise<RoomClientLike>;

type RoomClients = { host: RoomClientLike; audience: RoomClientLike };

const defaultClientFactory: RoomClientFactory = async (_role, settings, initialSnapshot) => {
  const [{ AgoraRtmAdapter }, { AgoraRtcAdapter }, { createVoiceRoomClient }] = await Promise.all([
    import('../runtime/agora/AgoraRtmAdapter'),
    import('../runtime/agora/AgoraRtcAdapter'),
    import('../runtime/VoiceRoomClient'),
  ]);
  return createVoiceRoomClient({
    rtm: new AgoraRtmAdapter(),
    rtc: new AgoraRtcAdapter(),
    settings,
    initialSnapshot,
  });
};

function disconnectedState(snapshot: VoiceRoomSnapshot): VoiceRoomClientState {
  return {
    rtmState: 'disconnected',
    rtcState: 'disconnected',
    hydrating: false,
    snapshot,
    onlineUsers: [],
    interactions: [],
    events: [],
    remoteAudioUsers: [],
    volumeLevels: {},
  };
}

function endpointSettings(
  role: EndpointRole,
  appId: string,
  roomId: string,
  endpoint: EndpointConnectionSettings,
): EndpointSettings {
  return {
    role,
    appId,
    roomId,
    userId: endpoint.userId,
    displayName: endpoint.displayName,
    rtmToken: endpoint.rtmToken,
    rtcToken: endpoint.rtcToken,
  };
}

function disconnectAndDestroy(client: RoomClientLike): void {
  void client.disconnect()
    .catch(() => undefined)
    .finally(() => client.destroy());
}

function disposeClients(clients: RoomClients): void {
  disconnectAndDestroy(clients.host);
  disconnectAndDestroy(clients.audience);
}

export function RoomPage({ clientFactory = defaultClientFactory }: { clientFactory?: RoomClientFactory }) {
  const { roomId = '' } = useParams();
  const [settings] = useState(loadConnectionSettings);
  const initialSnapshot = useRef(
    createInitialSnapshot(settings?.host.userId ?? 'host', settings?.host.displayName ?? '房主'),
  );
  const [hostState, setHostState] = useState(() => disconnectedState(initialSnapshot.current));
  const [audienceState, setAudienceState] = useState(() => disconnectedState(initialSnapshot.current));
  const [activeEndpoint, setActiveEndpoint] = useState<EndpointRole>('host');
  const [connecting, setConnecting] = useState(false);
  const [shellError, setShellError] = useState('');
  const clientsRef = useRef<RoomClients | null>(null);
  const subscriptionsRef = useRef<Array<() => void>>([]);
  const lifecycleRef = useRef(0);

  const connectClients = async (lifecycle = lifecycleRef.current) => {
    if (!settings || settings.roomId !== roomId || lifecycle !== lifecycleRef.current) return;
    setConnecting(true);
    setShellError('');
    try {
      let clients = clientsRef.current;
      if (!clients) {
        const [hostResult, audienceResult] = await Promise.allSettled([
          clientFactory(
            'host',
            endpointSettings('host', settings.appId, settings.roomId, settings.host),
            initialSnapshot.current,
          ),
          clientFactory(
            'audience',
            endpointSettings('audience', settings.appId, settings.roomId, settings.audience),
            initialSnapshot.current,
          ),
        ]);
        if (hostResult.status === 'rejected') {
          if (audienceResult.status === 'fulfilled') disconnectAndDestroy(audienceResult.value);
          throw hostResult.reason;
        }
        if (audienceResult.status === 'rejected') {
          disconnectAndDestroy(hostResult.value);
          throw audienceResult.reason;
        }
        const { value: host } = hostResult;
        const { value: audience } = audienceResult;
        if (lifecycle !== lifecycleRef.current) {
          disposeClients({ host, audience });
          return;
        }
        clients = { host, audience };
        clientsRef.current = clients;
        subscriptionsRef.current = [
          host.subscribe(setHostState),
          audience.subscribe(setAudienceState),
        ];
      }
      await clients.host.connect();
      if (lifecycle !== lifecycleRef.current) return;
      await clients.audience.connect();
    } catch (error) {
      if (lifecycle === lifecycleRef.current) {
        setShellError(error instanceof Error ? error.message : '双端连接失败');
      }
    } finally {
      if (lifecycle === lifecycleRef.current) setConnecting(false);
    }
  };

  useEffect(() => {
    if (!settings || settings.roomId !== roomId) return undefined;
    const lifecycle = lifecycleRef.current + 1;
    lifecycleRef.current = lifecycle;
    void connectClients(lifecycle);
    return () => {
      lifecycleRef.current += 1;
      subscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
      subscriptionsRef.current = [];
      const clients = clientsRef.current;
      clientsRef.current = null;
      if (clients) disposeClients(clients);
    };
  }, [clientFactory, roomId, settings]);

  if (!settings || settings.roomId !== roomId) {
    return <Navigate to="/?reason=missing-room-settings" replace />;
  }

  const sendCommand = (role: EndpointRole, command: VoiceRoomCommand) => {
    const client = clientsRef.current?.[role];
    if (client) void client.execute(command);
  };

  const bothConnected = hostState.rtmState === 'connected'
    && hostState.rtcState === 'connected'
    && audienceState.rtmState === 'connected'
    && audienceState.rtcState === 'connected';

  return (
    <main className="room-page">
      <header className="room-toolbar">
        <div className="room-title">
          <div className="brand-mark"><Radio aria-hidden="true" size={20} /></div>
          <div><span className="eyebrow">VOICE ROOM · {settings.roomId}</span><h1>语聊房 RTM + RTC 实践</h1></div>
        </div>
        <div className="toolbar-actions">
          <span className="headphones-chip"><Headphones aria-hidden="true" size={15} />耳机模式</span>
          <Link className="secondary-button" to="/"><ArrowLeft aria-hidden="true" size={15} />连接设置</Link>
          {shellError ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => void connectClients()}
              disabled={connecting}
            >
              <PlugZap aria-hidden="true" size={16} />重新连接
            </button>
          ) : (
            <span
              className={`connection-summary connection-summary--${bothConnected ? 'connected' : 'connecting'}`}
              role="status"
              aria-live="polite"
            >
              <PlugZap aria-hidden="true" size={16} />
              {connecting ? '正在自动连接' : bothConnected ? '两个客户端已连接' : '准备自动连接'}
            </span>
          )}
        </div>
      </header>

      <div className="room-notices">
        <HeadphonesWarning />
        <div className="governance-warning" role="note">
          <ShieldAlert aria-hidden="true" size={18} />
          <span><strong>演示治理边界</strong>生产环境必须由可信业务后端鉴权、仲裁并维护权威封禁状态。</span>
        </div>
      </div>
      {shellError && <p className="shell-error" role="alert">{shellError}</p>}

      <div className="endpoint-tabs" role="tablist" aria-label="客户端视图">
        <button
          type="button"
          role="tab"
          aria-selected={activeEndpoint === 'host'}
          onClick={() => setActiveEndpoint('host')}
        >房主端</button>
        <button
          type="button"
          role="tab"
          aria-selected={activeEndpoint === 'audience'}
          onClick={() => setActiveEndpoint('audience')}
        >听众端</button>
      </div>

      <div className="dual-room" data-testid="dual-room" data-active-endpoint={activeEndpoint}>
        <VoiceRoomClientView
          role="host"
          displayName={settings.host.displayName}
          userId={settings.host.userId}
          peerDisplayName={settings.audience.displayName}
          peerUserId={settings.audience.userId}
          state={hostState}
          shellDisabled={connecting}
          onCommand={(command) => sendCommand('host', command)}
        />
        <VoiceRoomClientView
          role="audience"
          displayName={settings.audience.displayName}
          userId={settings.audience.userId}
          peerDisplayName={settings.host.displayName}
          peerUserId={settings.host.userId}
          state={audienceState}
          shellDisabled={connecting}
          onCommand={(command) => sendCommand('audience', command)}
        />
      </div>
    </main>
  );
}
