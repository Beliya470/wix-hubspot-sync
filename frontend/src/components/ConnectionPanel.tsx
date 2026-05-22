import { useState } from 'react';
import { api, buildInstallUrl, InstallationSummary } from '../lib/api';

interface Props {
  installations: InstallationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}

export function ConnectionPanel({ installations, selectedId, onSelect, onChanged }: Props) {
  const [instanceId, setInstanceId] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = installations.find((i) => i.id === selectedId) ?? null;

  function startInstall() {
    setError(null);
    const id = instanceId.trim();
    if (!id) {
      setError('Enter a Wix instance id to begin installation.');
      return;
    }
    window.location.href = buildInstallUrl(id);
  }

  async function disconnect() {
    if (!selected) return;
    setDisconnecting(true);
    setError(null);
    try {
      await api.disconnect(selected.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'disconnect_failed');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>Connection</h2>
      <p style={{ marginTop: 0, color: '#52606d', fontSize: 13 }}>
        Link this Wix site to a HubSpot account so contacts can flow between them.
      </p>
      <div className="row" style={{ marginBottom: 16 }}>
        <label>
          Installation
          <select
            value={selectedId ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            style={{ marginLeft: 8, minWidth: 280 }}
          >
            <option value="">Select an installation</option>
            {installations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.wix_instance_id} {i.hubspot_portal_id ? `(portal ${i.hubspot_portal_id})` : ''}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <span className={`status-pill ${pillClass(selected.status, selected.connected)}`}>
            {selected.connected ? 'Connected' : selected.status}
          </span>
        )}
      </div>

      <div className="row">
        <input
          placeholder="Wix instance id"
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <button className="button" onClick={startInstall}>
          Connect HubSpot
        </button>
        {selected?.connected && (
          <button
            className="button danger"
            onClick={disconnect}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function pillClass(status: string, connected: boolean): string {
  if (connected) return 'connected';
  if (status === 'disconnected') return 'disconnected';
  return 'pending';
}
