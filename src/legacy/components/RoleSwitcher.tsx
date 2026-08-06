import type { ScenarioRole } from '../domain/scenario';

interface RoleSwitcherProps {
  roles: ScenarioRole[];
  value: string;
  onChange: (roleId: string) => void;
}

export function RoleSwitcher({ roles, value, onChange }: RoleSwitcherProps) {
  return (
    <fieldset className="role-switcher">
      <legend>当前视角</legend>
      <div className="segmented-control">
        {roles.map((role) => (
          <label key={role.id}>
            <input
              type="radio"
              name="scenario-role"
              value={role.id}
              checked={value === role.id}
              onChange={() => onChange(role.id)}
            />
            <span>{role.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
