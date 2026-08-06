import { ArrowLeft } from 'lucide-react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { getScenario } from '../domain/scenarioCatalog';
import { ScenarioWorkbench } from './ScenarioWorkbench';

function NotFound() {
  return (
    <AppShell>
      {() => (
        <div className="not-found">
          <span>404 / UNKNOWN SCENARIO</span>
          <h1>未找到这个场景</h1>
          <p>这个链接可能已失效，或者场景尚未加入实验室。</p>
          <Link to="/scenarios/social-presence"><ArrowLeft size={17} />返回第一个场景</Link>
        </div>
      )}
    </AppShell>
  );
}

function ScenarioRoute() {
  const { scenarioId = '' } = useParams();
  const scenario = getScenario(scenarioId);
  if (!scenario) return <NotFound />;
  return <ScenarioWorkbench key={scenario.id} scenario={scenario} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/scenarios/social-presence" replace />} />
      <Route path="/scenarios/:scenarioId" element={<ScenarioRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
