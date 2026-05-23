import { useEffect, useState } from 'react';
import { api, SyncLogEntry } from '../lib/api';

interface Props {
  installationId: string;
}

const STATUS_LABEL: Record<string, string> = {
  succeeded: 'Synced',
  skipped: 'Skipped',
  failed: 'Failed',
  started: 'In progress',
};

const REASON_LABEL: Record<string, string> = {
  loop_echo: 'mirrored a change we just made',
  idempotent_no_change: 'no field values changed',
  target_newer: 'the destination already has newer data',
  no_mapped_fields: 'no mapped fields to send',
  wix_contact_not_found: 'contact was not found in Wix',
  hubspot_contact_not_found: 'contact was not found in HubSpot',
};

const ORIGIN_LABEL: Record<string, string> = {
  wix: 'Wix webhook',
  hubspot: 'HubSpot webhook',
  form: 'Lead form',
  manual: 'Manual sync',
};

const DIRECTION_LABEL: Record<string, string> = {
  wix_to_hubspot: 'Wix → HubSpot',
  hubspot_to_wix: 'HubSpot → Wix',
  bidirectional: 'Both directions',
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const sec = Math.round(diffMs / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
}

function describe(entry: SyncLogEntry): string {
  const origin = ORIGIN_LABEL[entry.origin] ?? entry.origin;
  const direction = DIRECTION_LABEL[entry.direction] ?? entry.direction;
  const ids: string[] = [];
  if (entry.hubspot_contact_id) ids.push(`HubSpot ${entry.hubspot_contact_id}`);
  if (entry.wix_contact_id) ids.push(`Wix ${entry.wix_contact_id}`);
  return ids.length ? `${origin} · ${direction} · ${ids.join(', ')}` : `${origin} · ${direction}`;
}

function reason(entry: SyncLogEntry): string | null {
  if (entry.status === 'skipped' && entry.error_message) {
    return REASON_LABEL[entry.error_message] ?? entry.error_message.replace(/_/g, ' ');
  }
  if (entry.status === 'failed' && entry.error_message) return entry.error_message;
  return null;
}

export function SyncLogView({ installationId }: Props) {
  const [entries, setEntries] = useState<SyncLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  function refresh() {
    setRefreshing(true);
    api.syncLog(installationId)
      .then((r) => { setEntries(r.entries); setError(null); setLastRefreshedAt(new Date()); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load activity'))
      .finally(() => { setLoaded(true); setRefreshing(false); });
  }

  useEffect(() => {
    refresh();
    const handle = window.setInterval(refresh, 5000);
    return () => window.clearInterval(handle);
  }, [installationId]);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Activity</h2>
        <div className="row" style={{ gap: 12 }}>
          {lastRefreshedAt && (
            <span style={{ color: '#7b8794', fontSize: 12 }}>
              Updated {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
          <button className="button secondary" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
      <p style={{ marginTop: 8, marginBottom: 12, color: '#52606d', fontSize: 13 }}>
        A record of every contact change synced between Wix and HubSpot.
      </p>
      {error && <div className="error">{error}</div>}
      {loaded && !error && entries.length === 0 && (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#7b8794' }}>
          No activity yet. Submit a lead or trigger a sync to see it appear here.
        </div>
      )}
      {entries.map((e) => (
        <div className="log-entry" key={e.id}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className={`status-${e.status}`}><strong>{STATUS_LABEL[e.status] ?? e.status}</strong></span>
            <span style={{ color: '#7b8794' }}>{relativeTime(e.created_at)}</span>
          </div>
          <div style={{ marginTop: 4 }}>{describe(e)}</div>
          {reason(e) && <div style={{ marginTop: 4, color: '#52606d' }}>{reason(e)}</div>}
        </div>
      ))}
    </div>
  );
}
