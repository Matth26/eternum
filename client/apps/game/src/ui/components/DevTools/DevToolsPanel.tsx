import React, { useState } from 'react';
//import { BatchRealmsPerZoneScript } from './BatchRealmsPerZoneScript'; // Import the new script
import { AutoResourceProducerScript } from './AutoResourceProducerScript'; // Import the new auto resource producer script
import { BuildBuildingsScript } from './BuildBuildingsScript'; // Import the new script
import { CreateAttackingArmyScript } from './CreateAttackingArmyScript'; // Import the new army script
import { GetMyRealmsScript } from './GetMyRealmsScript'; // Import the new script
import { TransferResourcesScript } from './TransferResourcesScript'; // Import the new script

// Placeholder for where your script components will be imported
// import { BatchRealmSettleScript } from './BatchRealmSettleScript';

type ScriptId = 'getAllLocations' | 'batchRealmsPerZone' | 'getMyRealms' | 'transferResources' | 'getBaseMapTiles' | 'buildBuildings' | 'depositAllTransfers' | 'createAttackingArmies' | 'autoResourceProducer' | null; // Added 'autoResourceProducer'

interface Script {
  id: ScriptId;
  name: string;
  description: string;
  component: React.FC;
}

// Placeholder for when no script is selected or if a script is missing
const PlaceholderScriptComponent = () => <div>Select a script or implement the selected script's UI.</div>;

export const DevToolsPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true); // Panel is open by default
  const [selectedScript, setSelectedScript] = useState<ScriptId>(null);

  const availableScripts: Script[] = [
    //{ id: 'getAllLocations', name: 'Get base map tiles', component: GetBaseMapTilesScript },
    //{ id: 'batchRealmsPerZone', name: 'Settle realms per zone', description: 'Batch settle realms based on zone and bank availability.', component: BatchRealmsPerZoneScript },
    { id: 'getMyRealms', name: 'Get owned structures id', description: 'Fetches and displays all structures (realms, banks, villages) owned by the player.', component: GetMyRealmsScript }, // Add the new script here
    { id: 'buildBuildings', name: 'Create buildings', description: 'Build multiple buildings on specified realms using a JSON input.', component: BuildBuildingsScript },
    { id: 'transferResources', name: 'Transfer and deposit', description: 'Transfer resources between two realms using a JSON input.', component: TransferResourcesScript }, // Add the new script here
    { id: 'createAttackingArmies', name: 'Create All Realm Armies', description: 'Creates an attacking army in each realm with available troops.', component: CreateAttackingArmyScript },
    { id: 'autoResourceProducer', name: 'Auto Resource Producer', description: 'Automatically produces Labor and other resources in all realms.', component: AutoResourceProducerScript },
    //{ id: 'getBaseMapTiles', name: 'Get Base Map Tiles', description: 'Fetches and displays base map tiles from the backend.', component: GetBaseMapTilesScript },
    //{ id: 'depositAllTransfers', name: 'Deposit All Transfers', description: 'Finds and deposits all resource transfers ready to be offloaded at player structures.', component: DepositAllTransfersScript },
    // Add other scripts here
    // e.g. { id: 'anotherScript', name: 'Another Dev Script', component: AnotherScriptComponent },
  ];

  const ActiveScriptComponent = availableScripts.find(script => script.id === selectedScript)?.component || PlaceholderScriptComponent;

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: '20px',
    left: '65%',
    transform: 'translateX(-50%)',
    width: '400px',
    maxHeight: '80vh',
    backgroundColor: 'rgba(50, 50, 50, 0.9)',
    border: '1px solid #666',
    borderRadius: '8px',
    color: 'white',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  };

  const minimizedButtonStyle: React.CSSProperties = {
    position: 'fixed',
    top: '20px',
    left: '65%',
    transform: 'translateX(-50%)',
    padding: '10px 20px',
    backgroundColor: 'rgba(50, 50, 50, 0.9)',
    border: '1px solid #666',
    borderRadius: '8px',
    color: 'white',
    zIndex: 1000,
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  };

  const headerStyle: React.CSSProperties = {
    padding: '8px 12px',
    backgroundColor: '#444',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #666',
  };

  const contentStyle: React.CSSProperties = {
    padding: '12px',
    flexGrow: 1,
    overflowY: 'auto',
  };

  const scriptListStyle: React.CSSProperties = {
    listStyle: 'none',
    padding: '0',
    margin: '0',
  };

  const scriptListItemStyle: React.CSSProperties = {
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid #555',
  };
  
  const scriptListItemHoverStyle: React.CSSProperties = {
    backgroundColor: '#5A5A5A',
  };


  if (!isOpen) {
    return (
      <button
        style={minimizedButtonStyle}
        onClick={() => setIsOpen(true)}
      >
        Open Scripts Panel
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle} onClick={() => setIsOpen(false)}>
        <span>Game Scripts</span>
        <span>{selectedScript ? `Script: ${availableScripts.find(s => s.id === selectedScript)?.name}` : 'No script selected'}</span>
        <button onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2em' }}>
          &times; {/* Minimize/Close Icon */}
        </button>
      </div>
      <div style={contentStyle}>
        {selectedScript === null ? (
          <>
            <h4>Available Scripts:</h4>
            <ul style={scriptListStyle}>
              {availableScripts.map((script) => (
                <li
                  key={script.id}
                  style={scriptListItemStyle}
                  onClick={() => setSelectedScript(script.id)}
                  onMouseEnter={(e) => {
                    const targetStyle = (e.target as HTMLLIElement).style;
                    targetStyle.backgroundColor = scriptListItemHoverStyle.backgroundColor || '';
                  }}
                  onMouseLeave={(e) => {
                    const targetStyle = (e.target as HTMLLIElement).style;
                    targetStyle.backgroundColor = ''; 
                  }}
                >
                  {script.name}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <button 
              onClick={() => setSelectedScript(null)}
              style={{ marginBottom: '10px', padding: '5px 10px', backgroundColor: '#555', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer'}}
            >
              &larr; Back to Scripts
            </button>
            <ActiveScriptComponent />
          </>
        )}
      </div>
    </div>
  );
}; 