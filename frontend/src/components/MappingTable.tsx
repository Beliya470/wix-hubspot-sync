import { useEffect, useMemo, useState } from 'react';
import { api, FieldMapping, MappingOptions } from '../lib/api';

interface Props {
  installationId: string;
}

const EMPTY_ROW: FieldMapping = {
  wix_field: '',
  hubspot_property: '',
  direction: 'bidirectional',
  transform: null,
};

const DIRECTION_LABEL: Record<FieldMapping['direction'], string> = {
  wix_to_hubspot: 'Wix → HubSpot',
  hubspot_to_wix: 'HubSpot → Wix',
  bidirectional: 'Both directions',
};

const TRANSFORM_LABEL: Record<'trim' | 'lowercase', string> = {
  trim: 'Trim whitespace',
  lowercase: 'Lowercase',
};

export function MappingTable({ installationId }: Props) {
  const [options, setOptions] = useState<MappingOptions | null>(null);
  const [rows, setRows] = useState<FieldMapping[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setSavedMessage(null);
    Promise.all([api.options(installationId), api.listMappings(installationId)])
      .then(([opts, current]) => {
        setOptions(opts);
        setRows(current.mappings.length ? current.mappings : [EMPTY_ROW]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'load_failed'));
  }, [installationId]);

  const duplicateError = useMemo(() => validateRows(rows), [rows]);

  function updateRow(index: number, patch: Partial<FieldMapping>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSavedMessage(null);
  }

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
    setSavedMessage(null);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setSavedMessage(null);
  }

  async function save() {
    if (duplicateError) {
      setError(duplicateError);
      return;
    }
    const filtered = rows.filter((r) => r.wix_field && r.hubspot_property);
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const result = await api.saveMappings(installationId, filtered);
      setSavedMessage(`Saved ${result.count} mapping${result.count === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save_failed');
    } finally {
      setSaving(false);
    }
  }

  if (!options) {
    return <div className="card"><h2>Field mapping</h2><p>Loading…</p></div>;
  }

  return (
    <div className="card">
      <h2 style={{ marginBottom: 4 }}>Field mapping</h2>
      <p style={{ marginTop: 0, color: '#52606d', fontSize: 13 }}>
        Choose which contact details flow between Wix and HubSpot, and in which direction.
      </p>
      <table>
        <thead>
          <tr>
            <th>Wix field</th>
            <th>HubSpot property</th>
            <th>Direction</th>
            <th>Transform</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>
                <select
                  value={row.wix_field}
                  onChange={(e) => updateRow(index, { wix_field: e.target.value })}
                >
                  <option value="">Select...</option>
                  {options.wix_fields.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  value={row.hubspot_property}
                  onChange={(e) => updateRow(index, { hubspot_property: e.target.value })}
                >
                  <option value="">Select...</option>
                  {options.hubspot_properties.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  value={row.direction}
                  onChange={(e) => updateRow(index, { direction: e.target.value as FieldMapping['direction'] })}
                >
                  {options.directions.map((d) => (
                    <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  value={row.transform ?? ''}
                  onChange={(e) => updateRow(index, { transform: e.target.value === '' ? null : (e.target.value as 'trim' | 'lowercase') })}
                >
                  <option value="">No transform</option>
                  {options.transforms.map((t) => (
                    <option key={t} value={t}>{TRANSFORM_LABEL[t]}</option>
                  ))}
                </select>
              </td>
              <td>
                <button className="button secondary" onClick={() => removeRow(index)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="button secondary" onClick={addRow}>Add row</button>
        <button className="button" onClick={save} disabled={saving || !!duplicateError}>
          {saving ? 'Saving…' : 'Save mapping'}
        </button>
      </div>
      {duplicateError && <div className="error">{duplicateError}</div>}
      {error && <div className="error">{error}</div>}
      {savedMessage && <div className="success">{savedMessage}</div>}
    </div>
  );
}

function validateRows(rows: FieldMapping[]): string | null {
  const wix = new Map<string, number>();
  const hub = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.wix_field || !r.hubspot_property) continue;
    if ((wix.get(r.wix_field) ?? 0) > 0) {
      return `Duplicate Wix field "${r.wix_field}"`;
    }
    wix.set(r.wix_field, 1);
    const dirs = hub.get(r.hubspot_property) ?? new Set<string>();
    if (dirs.has(r.direction) || dirs.has('bidirectional') || r.direction === 'bidirectional' && dirs.size > 0) {
      return `Conflicting mapping for HubSpot property "${r.hubspot_property}"`;
    }
    dirs.add(r.direction);
    hub.set(r.hubspot_property, dirs);
  }
  return null;
}
