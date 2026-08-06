import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CONNECTION_STORAGE_KEY, ConnectionDialog } from './ConnectionDialog';

describe('ConnectionDialog', () => {
  it('stores connection data in sessionStorage only', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ConnectionDialog open onClose={() => undefined} onSave={onSave} />);

    await user.type(screen.getByLabelText('App ID'), 'app-id');
    await user.type(screen.getByLabelText('User ID'), 'host-1');
    await user.type(screen.getByLabelText('临时 Token'), 'temporary-token');
    await user.type(screen.getByLabelText('Channel ID'), 'voice-room-001');
    await user.click(screen.getByRole('button', { name: '保存连接设置' }));

    const expected = {
      appId: 'app-id',
      userId: 'host-1',
      token: 'temporary-token',
      channelId: 'voice-room-001',
      targetUserId: '',
    };
    expect(sessionStorage.getItem(CONNECTION_STORAGE_KEY)).toBe(JSON.stringify(expected));
    expect(localStorage.length).toBe(0);
    expect(onSave).toHaveBeenCalledWith(expected);
  });

  it('requires the secure connection fields and never asks for a certificate', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ConnectionDialog open onClose={() => undefined} onSave={onSave} />);

    expect(screen.queryByText(/App Certificate/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存连接设置' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写 App ID、User ID 和临时 Token');
    expect(onSave).not.toHaveBeenCalled();
  });
});
