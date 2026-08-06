import { KeyRound, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

export const CONNECTION_STORAGE_KEY = 'rtm-scenario-lab.connection';

export interface ConnectionSettings {
  appId: string;
  userId: string;
  token: string;
  channelId: string;
  targetUserId: string;
}

const emptySettings: ConnectionSettings = {
  appId: '',
  userId: '',
  token: '',
  channelId: '',
  targetUserId: '',
};

export function loadConnectionSettings(): ConnectionSettings | null {
  const serialized = sessionStorage.getItem(CONNECTION_STORAGE_KEY);
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<ConnectionSettings>;
    return {
      appId: typeof value.appId === 'string' ? value.appId : '',
      userId: typeof value.userId === 'string' ? value.userId : '',
      token: typeof value.token === 'string' ? value.token : '',
      channelId: typeof value.channelId === 'string' ? value.channelId : '',
      targetUserId: typeof value.targetUserId === 'string' ? value.targetUserId : '',
    };
  } catch {
    return null;
  }
}

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (settings: ConnectionSettings) => void;
  initial?: ConnectionSettings | null;
}

export function ConnectionDialog({ open, onClose, onSave, initial }: ConnectionDialogProps) {
  const [settings, setSettings] = useState<ConnectionSettings>(emptySettings);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setSettings(initial ?? loadConnectionSettings() ?? emptySettings);
      setError('');
    }
  }, [initial, open]);

  if (!open) return null;

  const update = (key: keyof ConnectionSettings, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!settings.appId.trim() || !settings.userId.trim() || !settings.token.trim()) {
      setError('请填写 App ID、User ID 和临时 Token');
      return;
    }
    const normalized = Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [key, value.trim()]),
    ) as unknown as ConnectionSettings;
    sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(normalized));
    onSave(normalized);
  };

  return (
    <div className="dialog-layer">
      <button className="dialog-scrim" aria-label="关闭连接设置" onClick={onClose} />
      <section className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-title">
        <header>
          <div className="dialog-icon"><KeyRound size={20} /></div>
          <div><span>REAL RTM</span><h2 id="connection-title">连接设置</h2></div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <p className="security-copy"><ShieldCheck size={16} />凭证仅保存在当前浏览器标签页，会话关闭后自动清除。</p>
        <form onSubmit={submit}>
          <label>App ID<input value={settings.appId} onChange={(event) => update('appId', event.target.value)} autoComplete="off" /></label>
          <label>User ID<input value={settings.userId} onChange={(event) => update('userId', event.target.value)} autoComplete="username" /></label>
          <label className="field-span">临时 Token<input type="password" value={settings.token} onChange={(event) => update('token', event.target.value)} autoComplete="off" /></label>
          <label>Channel ID<input value={settings.channelId} onChange={(event) => update('channelId', event.target.value)} placeholder="voice-room-001" /></label>
          <label>Target User ID<input value={settings.targetUserId} onChange={(event) => update('targetUserId', event.target.value)} placeholder="device-001" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button">保存连接设置</button></footer>
        </form>
      </section>
    </div>
  );
}
