import { useEffect, useState } from 'react';
import { api, InstallationSummary, registerWixInstall } from './lib/api';
import { ConnectionPanel } from './components/ConnectionPanel';
import { MappingTable } from './components/MappingTable';
import { SyncLogView } from './components/SyncLogView';
import { FormTester } from './components/FormTester';
import { SyncTester } from './components/SyncTester';

export default function App() {
  const [installations, setInstallations] = useState<InstallationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wixRegistering, setWixRegistering] = useState(false);
  const [wixError, setWixError] = useState<string | null>(null);

  function load(preferredId?: string) {
    return api.listInstallations()
      .then(({ installations }) => {
        setInstallations(installations);
        const params = new URLSearchParams(window.location.search);
        const fromQuery = preferredId ?? params.get('installation');
        if (fromQuery && installations.some((i) => i.id === fromQuery)) {
          setSelectedId(fromQuery);
        } else if (!selectedId && installations.length > 0) {
          setSelectedId(installations[0]!.id);
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load installations'));
  }

  useEffect(() => {
    // If Wix loaded us in its iframe, it puts a signed instance token in the
    // URL. Verify it server-side and use the returned installation id as the
    // selected one so the rest of the dashboard binds to the real Wix site.
    const params = new URLSearchParams(window.location.search);
    const instance = params.get('instance');
    if (instance) {
      setWixRegistering(true);
      registerWixInstall(instance)
        .then((result) => {
          setWixError(null);
          return load(result.installation_id);
        })
        .catch((e) => setWixError(e instanceof Error ? e.message : 'Could not register Wix install'))
        .finally(() => setWixRegistering(false));
    } else {
      load();
    }
  }, []);

  return (
    <div className="app">
      <h1>Wix HubSpot Sync</h1>
      <p className="subtitle">Keep your Wix contacts and HubSpot in sync, and capture every lead with where it came from.</p>

      {wixRegistering && <div className="card">Connecting this Wix site...</div>}
      {wixError && <div className="card error">{wixError}</div>}

      <ConnectionPanel
        installations={installations}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChanged={() => load()}
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
