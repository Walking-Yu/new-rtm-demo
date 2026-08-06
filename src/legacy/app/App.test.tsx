import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the RTM scenario lab identity', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('RTM 场景实验室')).toBeInTheDocument();
  });

  it('runs a scenario action and preserves state across role changes', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/scenarios/dispatch-order']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '派单与订单状态' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '派单' }));
    expect(screen.getByLabelText('当前状态')).toHaveTextContent('待接单');
    expect(screen.getByLabelText('事件时间线')).toHaveTextContent('派单');

    await user.click(screen.getByRole('radio', { name: '司机' }));
    expect(screen.getByLabelText('当前状态')).toHaveTextContent('待接单');
  });

  it('renders a useful not-found state', () => {
    render(
      <MemoryRouter initialEntries={['/scenarios/missing']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '未找到这个场景' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回第一个场景' })).toHaveAttribute(
      'href',
      '/scenarios/social-presence',
    );
  });

  it('offers real RTM mode only on the two representative scenarios', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/scenarios/voice-room-seats']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '模拟原型' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '真实 RTM' }));
    expect(screen.getByRole('dialog', { name: '连接设置' })).toBeInTheDocument();

    unmount();
    render(
      <MemoryRouter initialEntries={['/scenarios/social-chat']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: '真实 RTM' })).not.toBeInTheDocument();
  });
});
