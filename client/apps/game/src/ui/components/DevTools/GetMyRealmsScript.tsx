import { getOffchainRealm } from "@bibliothecadao/eternum";
import { useDojo } from "@bibliothecadao/react";
import { getComponentValue, Has, runQuery } from "@dojoengine/recs";
import React, { useCallback, useState } from 'react';

interface OwnedStructureInfo {
  category: string;
  name: string;
  entityId: string; 
}

export const GetMyRealmsScript: React.FC = () => {
  const {
    account: { account },
    setup: { components },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string>('');
  const [jsonDataOutput, setJsonDataOutput] = useState<string>('');

  const handleFetchOwnedRealms = useCallback(async () => {
    if (!account || !account.address) {
      setFeedback("Error: Account address not available. Please connect wallet.");
      setJsonDataOutput('');
      return;
    }
    if (!components?.Structure) {
      setFeedback("Error: Structure component not available in Dojo setup.");
      setJsonDataOutput('');
      return;
    }

    setIsLoading(true);
    setFeedback('Querying your owned Structures...');
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
                console.warn("Skipping structure due to missing entity_id:", structure);
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
        setFeedback('No owned Realms, Banks, or Villages found.');
        setJsonDataOutput('');
      } else {
        const jsonString = JSON.stringify(ownedStructures, null, 2);
        setJsonDataOutput(jsonString);
        setFeedback(`Successfully queried ${ownedStructures.length} owned structure(s).`);
      }
    } catch (error) {
      console.error("Error querying owned structures:", error);
      setFeedback(`Error: ${(error as Error).message}`);
      setJsonDataOutput('');
    } finally {
      setIsLoading(false);
    }
  }, [account, components]);

  const buttonStyle: React.CSSProperties = {
    padding: '10px 15px',
    marginTop: '10px',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1em',
    opacity: isLoading ? 0.7 : 1,
  };

  const feedbackStyle: React.CSSProperties = {
    marginTop: '10px',
    padding: '8px',
    backgroundColor: feedback.startsWith('Error:') ? '#d9534f' : (feedback.includes('No owned Realms, Banks, or Villages found') ? '#ffc107' : '#5bc0de'),
    color: feedback.startsWith('Error:') || feedback.includes('No owned Realms, Banks, or Villages found') ? '#000' : 'white',
    borderRadius: '4px',
    fontSize: '0.9em',
    whiteSpace: 'pre-wrap',
    minHeight: '30px',
  };

  const textAreaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '150px',
    marginTop: '10px',
    padding: '8px',
    border: '1px solid #777',
    borderRadius: '4px',
    backgroundColor: '#222',
    color: 'white',
    fontFamily: 'monospace',
    fontSize: '0.85em',
    boxSizing: 'border-box',
  };

  return (
    <div>
      <h4>Get owned structures id</h4>
      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
      </p>
      <button
        style={buttonStyle}
        onClick={handleFetchOwnedRealms}
        disabled={isLoading || !account?.address || !components?.Structure}
      >
        {isLoading ? 'Querying Structures...' : 'Fetch json data'}
      </button>
      <textarea
        style={textAreaStyle}
        value={jsonDataOutput}
        readOnly
        placeholder={'JSON output of your owned structures will appear here...'}
      />
      <div style={feedbackStyle}>
        {feedback || 'Click the button to query your owned structures.'}
      </div>
    </div>
  );
}; 