import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '../domain/transitions';
import type { VoiceRoomSnapshot } from '../domain/types';
import type {
  EndpointSettings,
  VoiceRoomClientState,
  VoiceRoomCommand,
} from '../runtime/VoiceRoomClient';
import { CONNECTION_SETTINGS_KEY, type VoiceRoomConnectionSettings } from './connectionSettings';
import { RoomPage, type RoomClientLike, type RoomClientFactory } from './RoomPage';

const settings: VoiceRoomConnectionSettings = {
  appId: 'app-id',
  roomId: 'room-1',
  host: {
    displayName: '房主', userId: 'host-1', rtmToken: 'secret-host-rtm', rtcToken: 'secret-host-rtc',
  },
  audience: {
    displayName: '听众', userId: 'audience-1', rtmToken: 'secret-audience-rtm', rtcToken: 'secret-audience-rtc',
  },
};

class FakeRoomClient implements RoomClientLike {
  readonly commands: VoiceRoomCommand[] = [];
  readonly connect = vi.fn(async () => {
    this.state = { ...this.state, rtmState: 'connected', rtcState: 'connected', hydrating: false };
    this.emit();
  });
  readonly disconnect = vi.fn(async () => undefined);
  readonly destroy = vi.fn();
  private listeners = new Set<(state: VoiceRoomClientState) => void>();

  constructor(private state: VoiceRoomClientState) {}

  getState() { return this.state; }
  subscribe(listener: (state: VoiceRoomClientState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  async execute(command: VoiceRoomCommand) { this.commands.push(command); }
  private emit() { this.listeners.forEach((listener) => listener(this.state)); }
}

function stateFor(role: EndpointSettings['role'], snapshot: VoiceRoomSnapshot): VoiceRoomClientState {
  return {
    rtmState: 'disconnected', rtcState: 'disconnected', hydrating: false,
    snapshot,
    onlineUsers: ['host-1', 'audience-1'],
    interactions: [], events: [], remoteAudioUsers: [], volumeLevels: {},
    ...(role === 'audience' ? {} : {}),
  };
}

function renderRoom(factory: RoomClientFactory) {
  sessionStorage.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify(settings));
  return render(
    <MemoryRouter initialEntries={['/room/room-1']}>
      <Routes><Route path="/room/:roomId" element={<RoomPage clientFactory={factory} />} /></Routes>
    </MemoryRouter>,
  );
}

describe('RoomPage', () => {
  it('creates and connects two independent clients automatically on room entry', async () => {
    const clients: FakeRoomClient[] = [];
    const factory: RoomClientFactory = vi.fn((role, _endpoint, snapshot) => {
      const client = new FakeRoomClient(stateFor(role, snapshot));
      clients.push(client);
      return client;
    });
    renderRoom(factory);

    expect(screen.getByRole('region', { name: '房主端' })).toBeVisible();
    expect(screen.getByRole('region', { name: '听众端' })).toBeVisible();
    expect(screen.getAllByTestId(/^seat-/)).toHaveLength(8);
    expect(screen.getAllByLabelText('4 个麦位')).toHaveLength(2);
    expect(document.body).not.toHaveTextContent('secret-host-rtm');

    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    expect(clients).toHaveLength(2);
    await vi.waitFor(() => {
      expect(clients[0].connect).toHaveBeenCalledOnce();
      expect(clients[1].connect).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole('button', { name: '连接两个客户端' })).not.toBeInTheDocument();
    expect(screen.getAllByText('已连接').length).toBeGreaterThanOrEqual(4);
  });

  it('passes undefined RTM and RTC tokens to both endpoint runtimes when omitted', async () => {
    const tokenlessSettings = {
      appId: 'app-id',
      roomId: 'room-1',
      host: { displayName: '房主', userId: 'host-1' },
      audience: { displayName: '听众', userId: 'audience-1' },
    };
    sessionStorage.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify(tokenlessSettings));
    const receivedSettings: EndpointSettings[] = [];
    const factory: RoomClientFactory = (role, endpoint, snapshot) => {
      receivedSettings.push(endpoint);
      return new FakeRoomClient(stateFor(role, snapshot));
    };
    render(
      <MemoryRouter initialEntries={['/room/room-1']}>
        <Routes><Route path="/room/:roomId" element={<RoomPage clientFactory={factory} />} /></Routes>
      </MemoryRouter>,
    );

    await vi.waitFor(() => expect(receivedSettings).toHaveLength(2));
    expect(receivedSettings.every((endpoint) => endpoint.rtmToken === undefined)).toBe(true);
    expect(receivedSettings.every((endpoint) => endpoint.rtcToken === undefined)).toBe(true);
  });

  it('renders role-specific queue and invitation controls', async () => {
    const user = userEvent.setup();
    const base = createInitialSnapshot('host-1', '房主');
    const shared: VoiceRoomSnapshot = {
      ...base,
      revision: 2,
      queue: [{
        id: 'request-1', userId: 'audience-1', displayName: '听众', seatId: 'seat-1', createdAt: 1,
      }],
      invitation: {
        id: 'invitation-1', hostUserId: 'host-1', userId: 'audience-1', displayName: '听众',
        seatId: 'seat-2', createdAt: 2,
      },
    };
    const clients = new Map<string, FakeRoomClient>();
    const factory: RoomClientFactory = (role) => {
      const client = new FakeRoomClient(stateFor(role, shared));
      clients.set(role, client);
      return client;
    };
    renderRoom(factory);

    const host = await screen.findByRole('region', { name: '房主端' });
    const audience = await screen.findByRole('region', { name: '听众端' });
    await vi.waitFor(() => {
      expect(within(host).getByRole('button', { name: '同意听众上麦' })).toBeVisible();
    });
    expect(within(host).getByRole('button', { name: '同意听众上麦' })).toBeVisible();
    expect(within(host).getByRole('button', { name: '拒绝听众上麦' })).toBeVisible();
    expect(within(audience).getByRole('button', { name: '接受上麦邀请' })).toBeVisible();
    expect(within(audience).getByRole('button', { name: '拒绝上麦邀请' })).toBeVisible();
    expect(within(host).queryByRole('button', { name: '取消排麦' })).not.toBeInTheDocument();
    expect(within(audience).getByRole('button', { name: '取消排麦' })).toBeVisible();

    await user.click(within(host).getByRole('button', { name: '同意听众上麦' }));
    await user.click(within(audience).getByRole('button', { name: '接受上麦邀请' }));
    expect(clients.get('host')?.commands).toContainEqual({ type: 'seat.request.approve', requestId: 'request-1' });
    expect(clients.get('audience')?.commands).toContainEqual({ type: 'seat.invite.accept' });
  });

  it('switches the mobile endpoint marker without destroying either runtime', async () => {
    const user = userEvent.setup();
    const clients: FakeRoomClient[] = [];
    const factory: RoomClientFactory = (role, _endpoint, snapshot) => {
      const client = new FakeRoomClient(stateFor(role, snapshot));
      clients.push(client);
      return client;
    };
    renderRoom(factory);
    await vi.waitFor(() => expect(clients).toHaveLength(2));

    const layout = screen.getByTestId('dual-room');
    expect(layout).toHaveAttribute('data-active-endpoint', 'host');
    await user.click(screen.getByRole('tab', { name: '听众端' }));
    expect(layout).toHaveAttribute('data-active-endpoint', 'audience');
    expect(screen.getByRole('region', { name: '房主端' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '听众端' })).toBeInTheDocument();
    expect(clients.every((client) => client.destroy.mock.calls.length === 0)).toBe(true);
  });

  it('offers an explicit retry only after automatic connection fails', async () => {
    const user = userEvent.setup();
    const clients = new Map<EndpointSettings['role'], FakeRoomClient>();
    const factory: RoomClientFactory = (role, _endpoint, snapshot) => {
      const client = new FakeRoomClient(stateFor(role, snapshot));
      if (role === 'host') client.connect.mockRejectedValueOnce(new Error('房主自动连接失败'));
      clients.set(role, client);
      return client;
    };
    renderRoom(factory);

    expect(await screen.findByRole('alert')).toHaveTextContent('房主自动连接失败');
    await user.click(screen.getByRole('button', { name: '重新连接' }));

    await vi.waitFor(() => {
      expect(clients.get('host')?.connect).toHaveBeenCalledTimes(2);
      expect(clients.get('audience')?.connect).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disposes the stale automatic clients created by StrictMode', async () => {
    const clients: FakeRoomClient[] = [];
    const factory: RoomClientFactory = (role, _endpoint, snapshot) => {
      const client = new FakeRoomClient(stateFor(role, snapshot));
      clients.push(client);
      return client;
    };
    sessionStorage.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify(settings));
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/room/room-1']}>
          <Routes><Route path="/room/:roomId" element={<RoomPage clientFactory={factory} />} /></Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await vi.waitFor(() => expect(clients).toHaveLength(4));
    await vi.waitFor(() => {
      expect(clients[0].disconnect).toHaveBeenCalledOnce();
      expect(clients[1].disconnect).toHaveBeenCalledOnce();
      expect(clients[0].destroy).toHaveBeenCalledOnce();
      expect(clients[1].destroy).toHaveBeenCalledOnce();
      expect(clients[2].connect).toHaveBeenCalledOnce();
      expect(clients[3].connect).toHaveBeenCalledOnce();
    });
  });
});
