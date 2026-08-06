import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CONNECTION_SETTINGS_KEY } from './connectionSettings';
import { SetupPage } from './SetupPage';

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('App ID'), 'app-id');
  await user.type(screen.getByLabelText('房主 RTM Token'), 'host-rtm');
  await user.type(screen.getByLabelText('房主 RTC Token'), 'host-rtc');
  await user.type(screen.getByLabelText('听众 RTM Token'), 'audience-rtm');
  await user.type(screen.getByLabelText('听众 RTC Token'), 'audience-rtc');
}

describe('SetupPage', () => {
  it('shows required validation and keeps Token fields concealed', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SetupPage /></MemoryRouter>);

    expect(screen.getByText('AGORA RTM 2.3.0 BETA + RTC WEB')).toBeVisible();
    expect(screen.getByText(/请佩戴耳机/)).toBeVisible();
    expect(screen.getAllByLabelText(/Token/)).toHaveLength(4);
    for (const input of screen.getAllByLabelText(/Token/)) expect(input).toHaveAttribute('type', 'password');
    expect(screen.queryByText(/App Certificate/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '保存并进入语聊房' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写 App ID');
  });

  it('rejects duplicate User IDs', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SetupPage /></MemoryRouter>);
    await fillCredentials(user);
    const audienceId = screen.getByLabelText('听众 User ID');
    await user.clear(audienceId);
    await user.type(audienceId, 'host-001');
    await user.click(screen.getByRole('button', { name: '保存并进入语聊房' }));

    expect(screen.getByRole('alert')).toHaveTextContent('房主和听众必须使用不同的 User ID');
  });

  it('stores normalized settings in sessionStorage and continues', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<MemoryRouter><SetupPage onContinue={onContinue} /></MemoryRouter>);
    await fillCredentials(user);

    await user.click(screen.getByRole('button', { name: '保存并进入语聊房' }));

    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app-id', roomId: 'voice-room-001',
      host: expect.objectContaining({ userId: 'host-001', rtmToken: 'host-rtm' }),
      audience: expect.objectContaining({ userId: 'audience-001', rtcToken: 'audience-rtc' }),
    }));
    expect(sessionStorage.getItem(CONNECTION_SETTINGS_KEY)).not.toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('continues without Token values and passes undefined to the room settings', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<MemoryRouter><SetupPage onContinue={onContinue} /></MemoryRouter>);
    await user.type(screen.getByLabelText('App ID'), 'app-id');

    await user.click(screen.getByRole('button', { name: '保存并进入语聊房' }));

    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({
      host: expect.objectContaining({ rtmToken: undefined, rtcToken: undefined }),
      audience: expect.objectContaining({ rtmToken: undefined, rtcToken: undefined }),
    }));
  });
});
