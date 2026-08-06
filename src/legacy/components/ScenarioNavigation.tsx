import { Activity, Boxes, RadioTower } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { scenarioGroups } from '../domain/scenarioCatalog';

interface ScenarioNavigationProps {
  onNavigate?: () => void;
}

export function ScenarioNavigation({ onNavigate }: ScenarioNavigationProps) {
  return (
    <div className="navigation-inner">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          <RadioTower size={19} strokeWidth={2.2} />
        </span>
        <div>
          <strong>RTM 场景实验室</strong>
          <span>Capability Lab</span>
        </div>
      </div>

      <div className="navigation-summary" aria-label="场景概览">
        <span><Boxes size={15} />24 个场景</span>
        <span><Activity size={15} />2 个真实链路</span>
      </div>

      <nav className="scenario-groups">
        {scenarioGroups.map((group) => (
          <section className="scenario-group" key={group.id}>
            <h2>{group.label}</h2>
            <div className="scenario-links">
              {group.scenarios.map((scenario) => (
                <NavLink
                  key={scenario.id}
                  to={`/scenarios/${scenario.id}`}
                  onClick={onNavigate}
                  className={({ isActive }) => (isActive ? 'scenario-link scenario-link--active' : 'scenario-link')}
                >
                  <span>{scenario.title}</span>
                  {scenario.supportsRealRtm && <i aria-label="支持真实 RTM">LIVE</i>}
                </NavLink>
              ))}
            </div>
          </section>
        ))}
      </nav>
    </div>
  );
}
