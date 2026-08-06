import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('standalone voice-room app', () => {
  it('renders the product identity and headphones warning', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '语聊房 RTM + RTC 实践' })).toBeVisible();
    expect(screen.getByText(/请佩戴耳机/)).toBeVisible();
  });

  it('returns an unknown route to setup with a clear error', async () => {
    render(
      <MemoryRouter initialEntries={['/old-scenario-page']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '语聊房 RTM + RTC 实践' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('页面不存在，已返回连接设置');
  });
});
