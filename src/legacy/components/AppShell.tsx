import { useState, type ReactNode } from 'react';
import { ScenarioNavigation } from './ScenarioNavigation';

interface AppShellProps {
  children: (openNavigation: () => void) => ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${navigationOpen ? 'sidebar--open' : ''}`} aria-label="场景导航">
        <ScenarioNavigation onNavigate={() => setNavigationOpen(false)} />
      </aside>
      {navigationOpen && (
        <button
          className="navigation-scrim"
          aria-label="关闭场景导航"
          onClick={() => setNavigationOpen(false)}
        />
      )}
      <main className="app-main">{children(() => setNavigationOpen(true))}</main>
    </div>
  );
}
