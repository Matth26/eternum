import { TabPanel } from '@/ui/elements/tab/tab-panel';
import { TabPanels } from '@/ui/elements/tab/tab-panels';
import { Tab } from '@headlessui/react';
import React, { useCallback, useState } from 'react';
import { AutoExploreArmiesScript } from './AutoExploreArmiesScript';
import { AutoResourceProducerScript } from './AutoResourceProducerScript';
import { BuildBuildingsScript } from './BuildBuildingsScript';
import { CreateAttackingArmyScript } from './CreateAttackingArmyScript';
import { GetMyRealmsScript } from './GetMyRealmsScript';
import { TransferResourcesScript } from './TransferResourcesScript';
// import { BatchRealmsPerZoneScript } from './BatchRealmsPerZoneScript';
// import { GetBaseMapTilesScript } from './GetBaseMapTilesScript';

export interface CompanionLogEntry {
  timestamp: Date;
  message: string;
  type?: 'info' | 'error' | 'success';
  script?: string;
}

export const CompanionUI: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [logs, setLogs] = useState<CompanionLogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(true);

  // Shared log function to be passed to scripts
  const log = useCallback((message: string, type: CompanionLogEntry['type'] = 'info', script?: string) => {
    setLogs(prev => [{ timestamp: new Date(), message, type, script }, ...prev].slice(0, 200));
  }, []);

  // Global import/export settings handlers
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const exportSettings = () => {
    // Placeholder: export empty object or future settings
    const data = {};
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'companionSettings.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const importSettings = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Placeholder: handle imported settings in the future
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // const data = JSON.parse(e.target?.result as string);
        // TODO: apply settings globally if needed
      } catch (err) {
        // TODO: handle error
      }
    };
    reader.readAsText(file);
  };
  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // Tab and script order
  const tabCategories = [
    {
      name: 'Production',
      scripts: [
        { name: 'Get owned structures id', component: GetMyRealmsScript },
        { name: 'Create buildings', component: BuildBuildingsScript },
        { name: 'Transfer and deposit', component: TransferResourcesScript },
        { name: 'Auto Resource Producer', component: AutoResourceProducerScript },
      ],
    },
    {
      name: 'Army Movements',
      scripts: [
        { name: 'Create All Realm Armies', component: CreateAttackingArmyScript },
        { name: 'Auto Explore Armies', component: AutoExploreArmiesScript },
      ],
    },
    {
      name: 'Settings',
      scripts: [
        { name: 'Export and import settings', component: () => (
          <div style={{ fontSize: '0.9em', color: '#ccc', fontFamily: 'monospace' }}>
            <div style={{ marginBottom: 8 }}>Export and import your settings to a JSON file.</div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <button
                style={{ padding: '6px 12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.95em' }}
                onClick={exportSettings}
              >
                Export Settings
              </button>
              <button
                style={{ padding: '6px 12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.95em' }}
                onClick={handleImportClick}
              >
                Import Settings
              </button>
              <input ref={fileInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={importSettings} />
            </div>
          </div>
        ) },
        { name: 'Resource Types', component: () => (
          <div style={{ fontSize: '0.9em', color: '#ccc', fontFamily: 'monospace' }}>
            <div style={{ marginBottom: 8 }}><b>Resource Types</b>: Use these names in transfer/build scripts.</div>
            <pre style={{ maxHeight: 120, overflowY: 'auto', background: '#222', padding: 8, borderRadius: 4 }}>
              {`Stone, Coal, Wood, Copper, Ironwood, Obsidian, Gold, Silver, Mithral, AlchemicalSilver, ColdIron, DeepCrystal, Ruby, Diamonds, Hartwood, Ignium, TwilightQuartz, TrueIce, Adamantine, Sapphire, EtherealSilica, Dragonhide, Labor, AncientFragment, Donkey, Knight, KnightT2, KnightT3, Crossbowman, CrossbowmanT2, CrossbowmanT3, Paladin, PaladinT2, PaladinT3, Wheat, Fish, Lords`}
            </pre>
            <div style={{ marginTop: 8, color: '#aaa', fontSize: '0.85em' }}>Use these resource names in the JSON for transfer/build scripts.</div>
          </div>
        ) },
        { name: 'Building Types', component: () => (
          <div style={{ fontSize: '0.9em', color: '#ccc', fontFamily: 'monospace' }}>
            <div style={{ marginBottom: 8 }}><b>Building Types</b>: Use these names in build scripts.</div>
            <pre style={{ maxHeight: 120, overflowY: 'auto', background: '#222', padding: 8, borderRadius: 4 }}>
              {`WorkersHut, Storehouse, ResourceStone, ResourceCoal, ResourceWood, ResourceCopper, ResourceIronwood, ResourceObsidian, ResourceGold, ResourceSilver, ResourceMithral, ResourceAlchemicalSilver, ResourceColdIron, ResourceDeepCrystal, ResourceRuby, ResourceDiamonds, ResourceHartwood, ResourceIgnium, ResourceTwilightQuartz, ResourceTrueIce, ResourceAdamantine, ResourceSapphire, ResourceEtherealSilica, ResourceDragonhide, ResourceLabor, ResourceAncientFragment, ResourceDonkey, ResourceKnightT1, ResourceKnightT2, ResourceKnightT3, ResourceCrossbowmanT1, ResourceCrossbowmanT2, ResourceCrossbowmanT3, ResourcePaladinT1, ResourcePaladinT2, ResourcePaladinT3, ResourceWheat, ResourceFish`}
            </pre>
            <div style={{ marginTop: 8, color: '#aaa', fontSize: '0.85em' }}>Use these building names in the JSON for build scripts.</div>
          </div>
        ) },
        { name: 'About Scripts', component: () => (
          <div style={{ fontSize: '0.95em', color: '#ccc', fontFamily: 'monospace' }}>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#aaa', fontSize: '0.92em' }}>
              <li><b>Get owned structures id</b>: Fetches your owned Realms, Banks, and Villages as JSON.</li>
              <li><b>Transfer and deposit</b>: Batch transfer resources between realms and deposit arrivals.</li>
              <li><b>Auto Resource Producer</b>: Prepares and executes resource production plans for your realms.</li>
              <li><b>Create buildings</b>: Batch create buildings on your realms using JSON input.</li>
              <li><b>Auto Explore Armies</b>: Moves armies to explore adjacent tiles automatically.</li>
              <li><b>Create All Realm Armies</b>: Creates armies for all your realms if resources are available.</li>
            </ul>
          </div>
        ) },
      ],
    },
  ];

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: '2%',
    left: '60%',
    transform: 'translateX(-50%)',
    width: '40%',
    height: '90%',
    backgroundColor: 'rgba(40, 40, 40, 0.98)',
    border: '1px solid #666',
    borderRadius: '12px',
    color: 'white',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
    overflow: 'hidden',
  };

  const contentContainerStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    background: '#232323',
  };

  const minimizedButtonStyle: React.CSSProperties = {
    position: 'fixed',
    top: '2%',
    left: '60%',
    transform: 'translateX(-50%)',
    padding: '12px 28px',
    backgroundColor: 'rgba(40, 40, 40, 0.98)',
    border: '1px solid #666',
    borderRadius: '12px',
    color: 'white',
    zIndex: 1000,
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
    fontSize: '1.1em',
  };

  const headerStyle: React.CSSProperties = {
    padding: '12px 18px',
    backgroundColor: '#333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #666',
    fontSize: '1.2em',
    fontWeight: 600,
    cursor: 'pointer',
    userSelect: 'none',
  };
  
  const logAreaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '80px',
    maxHeight: '120px',
    background: '#181818',
    color: '#fff',
    border: '1px solid #444',
    borderRadius: '6px',
    fontFamily: 'monospace',
    fontSize: '0.95em',
    margin: '8px 0 0 0',
    padding: '8px',
    overflowY: 'auto',
    resize: 'none',
  };

  if (!isOpen) {
    return (
      <button style={minimizedButtonStyle} onClick={() => setIsOpen(true)}>
        Open Companion UI
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle} onClick={() => setIsOpen(false)}>
        <span>Companion UI</span>
        <button
          onClick={e => { e.stopPropagation(); setIsOpen(false); }}
          style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.5em' }}
        >
          &times;
        </button>
      </div>
      <div style={contentContainerStyle}>
        <Tab.Group>
          <Tab.List className="flex bg-[#222] border-b border-[#444]">
            {tabCategories.map((tab) => (
              <Tab
                key={tab.name}
                className={({ selected }) =>
                  `flex-1 py-3 px-4 text-lg font-semibold focus:outline-none transition-colors duration-150 ${
                    selected ? 'bg-[#444] text-white' : 'bg-[#222] text-[#aaa] hover:bg-[#333]'
                  }`
                }
              >
                {tab.name}
              </Tab>
            ))}
          </Tab.List>
          <TabPanels className="flex-1">
            {tabCategories.map((tab) => (
              <TabPanel key={tab.name} className="h-full p-4">
                <div className="space-y-8">
                  {tab.scripts.map((script) => (
                    <div key={script.name} className="bg-[#292929] rounded-lg p-4 shadow">
                      {/* Script title */}
                      <div style={{ fontWeight: 600, fontSize: '1.08em', color: '#fff', marginBottom: 8 }}>{script.name}</div>
                      {/* Pass log and setLogs as props to each script */}
                      <script.component log={log} logs={logs} setLogs={setLogs} />
                    </div>
                  ))}
                </div>
              </TabPanel>
            ))}
          </TabPanels>
        </Tab.Group>
      </div>
      
      {/* Toggleable log area at the bottom */}
      <div style={{ padding: '0 18px 12px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ fontWeight: 500, color: '#aaa', marginBottom: 0, display: 'block', fontSize: '1em' }}>Logs</label>
            <button 
            onClick={() => setShowLogs(v => !v)}
            style={{ background: '#222', color: '#aaa', border: '1px solid #444', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: '0.95em', marginLeft: 12 }}
            >
            {showLogs ? 'Hide Logs' : 'Show Logs'}
            </button>
        </div>
        {showLogs && (
          <div style={{
            background: 'rgba(30, 30, 30, 0.98)',
            borderTop: '1px solid #666',
            borderRadius: '0 0 10px 10px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            padding: '10px 12px',
            marginTop: 0,
            marginBottom: 0,
            transition: 'box-shadow 0.2s',
          }}>
            <textarea
              style={{
                width: '100%',
                minHeight: '80px',
                maxHeight: '120px',
                background: 'transparent',
                color: '#fff',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: 'monospace',
                fontSize: '0.95em',
                padding: 0,
                boxShadow: 'none',
                overflowY: 'auto',
              }}
              value={logs.map(l => `[${l.timestamp.toLocaleTimeString()}]${l.script ? ' [' + l.script + ']' : ''} ${l.message}`).join('\n')}
              readOnly
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const DevToolsPanel = CompanionUI; 