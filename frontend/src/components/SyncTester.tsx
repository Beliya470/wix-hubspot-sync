import { useState } from 'react';
import { api } from '../lib/api';

interface Props {
  installationId: string;
}

type Direction = 'wix_to_hubspot' | 'hubspot_to_wix';

export function SyncTester({ installationId }: Props) {
  const [direction, setDirection] = useState<Direction>('hubspot_to_wix');
  const [contactId, setContactId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; reason?: string } | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = direction === 'wix_to_hubspot'
        ? await api.trigger(installationId, { direction, wix_contact_id: contactId })
        : await api.trigger(installationId, { direction, hubspot_contact_id: contactId });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'trigger_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Resync a contact</h2>
      <p style={{ marginTop: 0, color: '#52606d', fontSize: 13 }}>
        Force a single contact to sync now. Handy after changing your field mapping, or to fix a contact that didn't
        sync correctly.
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <label>
          Direction
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            style={{ marginLeft: 8 }}
          >
            <option value="hubspot_to_wix">HubSpot &rarr; Wix</option>
            <option value="wix_to_hubspot">Wix &rarr; HubSpot</option>
          </select>
        </label>
        <label style={{ flex: 1 }}>
          {direction === 'wix_to_hubspot' ? 'Wix contact id' : 'HubSpot contact id'}
          <input
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            placeholder={direction === 'wix_to_hubspot' ? 'e.g. wix-contact-uuid' : 'e.g. 12345'}
            style={{ marginLeft: 8, width: 320 }}
          />
        </label>
        <button className="button" onClick={run} disabled={busy || !contactId}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {result && (
        <div className={result.status === 'succeeded' ? 'success' : 'error'}>
          Result: <strong>{result.status.toUpperCase()}</strong>
          {result.reason ? `. ${result.reason}` : ''}
        </div>
      )}
    </div>
  );
}
