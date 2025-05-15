import { getOffchainRealm } from "@bibliothecadao/eternum";
import { useDojo } from "@bibliothecadao/react";
import { getComponentValue, Has, runQuery } from "@dojoengine/recs";
import React, { useCallback, useState } from 'react';

interface OwnedStructureInfo {
  category: string;
  name: string;
  entityId: string; 
}

interface GetMyRealmsScriptProps {
  log: (message: string, type?: 'info' | 'error' | 'success', script?: string) => void;
}

export const GetMyRealmsScript: React.FC<GetMyRealmsScriptProps> = ({ log }) => {
  const {
    account: { account },
    setup: { components },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);
  const [jsonDataOutput, setJsonDataOutput] = useState<string>('');

  const handleFetchOwnedRealms = useCallback(async () => {
    if (!account || !account.address) {
      log("Error: Account address not available. Please connect wallet.", 'error', 'GetMyRealms');
      setJsonDataOutput('');
      return;
    }
    if (!components?.Structure) {
      log("Error: Structure component not available in Dojo setup.", 'error', 'GetMyRealms');
      setJsonDataOutput('');
      return;
    }
    setIsLoading(true);
    log('Querying your owned Structures...', 'info', 'GetMyRealms');
    setJsonDataOutput('');
    try {
      const ownedStructures: OwnedStructureInfo[] = [];
      const structureEntities = runQuery([Has(components.Structure)]);
      for (const entityIdValue of structureEntities) {
        const structure = getComponentValue(components.Structure, entityIdValue);
        if (structure && structure.owner) {
          const ownerAddressHex = "0x" + structure.owner.toString(16);
          if (ownerAddressHex.toLowerCase() === account.address.toLowerCase()) {
            const numericCategory = Number(structure.category);
            let categoryString: string = "Unknown";
            let name = "Unknown Structure";
            const entityIdString = structure.entity_id?.toString();
            if (!entityIdString) {
                log("Skipping structure due to missing entity_id", 'error', 'GetMyRealms');
                continue;
            }
            if (numericCategory === 1) { // Realm
              categoryString = "Realm";
              name = "Realm (Fetching name...)"; // Placeholder, will be refined
              const originalRealmIdForName = Number(structure.metadata?.realm_id);
              if (!isNaN(originalRealmIdForName) && originalRealmIdForName !== 0) {
                const offchainData = getOffchainRealm(originalRealmIdForName);
                name = offchainData ? offchainData.name : `Realm ${originalRealmIdForName} (Name N/A)`;
              } else {
                name = `Realm (Invalid original realm_id: ${structure.metadata?.realm_id})`;
              }
            } else if (numericCategory === 3) { // Bank
              categoryString = "Bank";
              name = "Bank";
            } else if (numericCategory === 5) { // Village
              categoryString = "Village";
              name = "Village";
            } else {
              continue;
            }
            ownedStructures.push({
              category: categoryString,
              name: name,
              entityId: entityIdString,
            });
          }
        }
      }
      ownedStructures.sort((a, b) => {
        if (a.category !== b.category) {
          return a.category.localeCompare(b.category);
        }
        return a.entityId.localeCompare(b.entityId);
      });
      if (ownedStructures.length === 0) {
        log('No owned Realms, Banks, or Villages found.', 'info', 'GetMyRealms');
        setJsonDataOutput('');
      } else {
        const jsonString = JSON.stringify(ownedStructures, null, 2);
        setJsonDataOutput(jsonString);
        log(`Successfully queried ${ownedStructures.length} owned structure(s).`, 'success', 'GetMyRealms');
      }
    } catch (error) {
      log(`Error querying owned structures: ${(error as Error).message}`, 'error', 'GetMyRealms');
      setJsonDataOutput('');
    } finally {
      setIsLoading(false);
    }
  }, [account, components, log]);

  const buttonStyle: React.CSSProperties = {
    padding: '6px 12px',
    margin: '0 0 6px 0',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.95em',
    opacity: isLoading ? 0.7 : 1,
  };
  const textAreaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '5%',
    marginTop: '6px',
    padding: '6px',
    border: '1px solid #777',
    borderRadius: '4px',
    backgroundColor: '#222',
    color: 'white',
    fontFamily: 'monospace',
    fontSize: '0.85em',
    boxSizing: 'border-box',
  };
  return (
    <div style={{ padding: 0, border: 'none', margin: 0 }}>
      <textarea
        style={Object.assign({}, textAreaStyle, { minHeight: '40px', marginBottom: '6px', marginTop: 0 })}
        value={jsonDataOutput}
        readOnly
        placeholder={'JSON output will appear here...'}
      />
      <button
        style={buttonStyle}
        onClick={handleFetchOwnedRealms}
        disabled={isLoading || !account?.address || !components?.Structure}
      >
        {isLoading ? 'Querying...' : 'Fetch structures'}
      </button>
    </div>
  );
}; 