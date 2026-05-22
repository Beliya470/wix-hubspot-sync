import { useEffect, useState } from 'react';
import { api, InstallationSummary } from './lib/api';
import { ConnectionPanel } from './components/ConnectionPanel';
import { MappingTable } from './components/MappingTable';
import { SyncLogView } from './components/SyncLogView';
import { FormTester } from './components/FormTester';
import { SyncTester } from './components/SyncTester';

export default function App() {
  const [installations, setInstallations] = useState<InstallationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    api.listInstallations()
      .then(({ installations }) => {
        setInstallations(installations);
        const params = new URLSearchParams(window.location.search);
        const fromQuery = params.get('installation');
        if (fromQuery && installations.some((i) => i.id === fromQuery)) {
          setSelectedId(fromQuery);
        } else if (!selectedId && installations.length > 0) {
          setSelectedId(installations[0]!.id);
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'load_failed'));
  }

  useEffect(load, []);

  return (
    <div className="app">
      <h1>Wix HubSpot Sync</h1>
      <p className="subtitle">Keep your Wix contacts and HubSpot in sync, and capture every lead with where it came from.</p>

      <ConnectionPanel
        installations={installations}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChanged={load}
      />

      {loadError && <div className="card error">{loadError}</div>}

      {selectedId && (
        <>
          <MappingTable installationId={selectedId} />
          <FormTester wixInstanceId={installations.find((i) => i.id === selectedId)?.wix_instance_id ?? ''} />
          <SyncTester installationId={selectedId} />
          <SyncLogView installationId={selectedId} />
        </>
      )}
    </div>
  );
}
