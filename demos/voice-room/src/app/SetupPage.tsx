import { KeyRound, PlugZap, Radio, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HeadphonesWarning } from '../components/HeadphonesWarning';
import {
  emptyConnectionSettings,
  loadConnectionSettings,
  saveConnectionSettings,
  type EndpointConnectionSettings,
  type VoiceRoomConnectionSettings,
} from './connectionSettings';

interface SetupPageProps {
  onContinue?: (settings: VoiceRoomConnectionSettings) => void;
}

function initialSettings(): VoiceRoomConnectionSettings {
  const saved = loadConnectionSettings() ?? emptyConnectionSettings;
  return {
    ...saved,
    host: { ...saved.host },
    audience: { ...saved.audience },
  };
}

interface EndpointFieldsProps {
  legend: string;
  prefix: 'host' | 'audience';
  value: EndpointConnectionSettings;
  onChange: (field: keyof EndpointConnectionSettings, value: string) => void;
}

function EndpointFields({ legend, prefix, value, onChange }: EndpointFieldsProps) {
  return (
    <fieldset className="endpoint-fields">
      <legend>{legend}</legend>
      <div className="form-grid">
        <label>
          <span>{legend}显示名</span>
          <input
            aria-label={`${legend}显示名`}
            value={value.displayName}
            onChange={(event) => onChange('displayName', event.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          <span>{legend} User ID</span>
          <input
            aria-label={`${legend} User ID`}
            value={value.userId}
            onChange={(event) => onChange('userId', event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="token-field">
          <span>{legend} RTM Token（可选）</span>
          <input
            aria-label={`${legend} RTM Token`}
            type="password"
            value={value.rtmToken ?? ''}
            onChange={(event) => onChange('rtmToken', event.target.value)}
            autoComplete="off"
            data-endpoint={prefix}
          />
        </label>
        <label className="token-field">
          <span>{legend} RTC Token（可选）</span>
          <input
            aria-label={`${legend} RTC Token`}
            type="password"
            value={value.rtcToken ?? ''}
            onChange={(event) => onChange('rtcToken', event.target.value)}
            autoComplete="off"
            data-endpoint={prefix}
          />
        </label>
      </div>
    </fieldset>
  );
}

export function SetupPage({ onContinue }: SetupPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState('');
  const routeNotice = searchParams.get('reason') === 'unknown-route'
    ? '页面不存在，已返回连接设置'
    : searchParams.get('reason') === 'missing-room-settings'
      ? '房间凭证不存在或与地址不匹配，请重新填写'
      : '';

  const updateEndpoint = (
    endpoint: 'host' | 'audience',
    field: keyof EndpointConnectionSettings,
    value: string,
  ) => {
    setSettings((current) => ({
      ...current,
      [endpoint]: { ...current[endpoint], [field]: value },
    }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const normalized = saveConnectionSettings(settings);
      setError('');
      if (onContinue) onContinue(normalized);
      else navigate(`/room/${encodeURIComponent(normalized.roomId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '连接设置无效');
    }
  };

  return (
    <main className="setup-page">
      <header className="setup-header">
        <div className="brand-mark"><Radio aria-hidden="true" size={22} /></div>
        <div>
          <span className="eyebrow">AGORA RTM 2.3.0 BETA + RTC WEB</span>
          <h1>语聊房 RTM + RTC 实践</h1>
        </div>
      </header>

      <HeadphonesWarning />
      {routeNotice && <p className="route-notice" role="alert">{routeNotice}</p>}

      <form className="setup-form" onSubmit={submit} noValidate>
        <div className="form-heading">
          <KeyRound aria-hidden="true" size={20} />
          <div><span>REAL CLIENTS</span><h2>连接设置</h2></div>
        </div>

        <fieldset className="shared-fields">
          <legend>共享配置</legend>
          <div className="form-grid">
            <label>
              <span>App ID</span>
              <input
                aria-label="App ID"
                value={settings.appId}
                onChange={(event) => setSettings((current) => ({ ...current, appId: event.target.value }))}
                autoComplete="off"
              />
            </label>
            <label>
              <span>房间 ID</span>
              <input
                aria-label="房间 ID"
                value={settings.roomId}
                onChange={(event) => setSettings((current) => ({ ...current, roomId: event.target.value }))}
                autoComplete="off"
              />
            </label>
          </div>
        </fieldset>

        <div className="endpoint-settings-grid">
          <EndpointFields
            legend="房主"
            prefix="host"
            value={settings.host}
            onChange={(field, value) => updateEndpoint('host', field, value)}
          />
          <EndpointFields
            legend="听众"
            prefix="audience"
            value={settings.audience}
            onChange={(field, value) => updateEndpoint('audience', field, value)}
          />
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="setup-actions">
          <p><ShieldCheck aria-hidden="true" size={16} />凭证仅保存在当前标签页，关闭后自动清除。</p>
          <button className="primary-button" type="submit">
            <PlugZap aria-hidden="true" size={17} />
            保存并进入语聊房
          </button>
        </footer>
      </form>
    </main>
  );
}
