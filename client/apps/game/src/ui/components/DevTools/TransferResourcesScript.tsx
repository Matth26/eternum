import { useDojo } from "@bibliothecadao/react";
import { RESOURCE_PRECISION } from "@bibliothecadao/types";
import React, { useCallback, useEffect, useState } from 'react';
// Assuming a system call like transfer_resources_between_entities exists.
// Adjust if your system call has a different name or signature.

// IMPORTANT: Populate this with your game's actual resource names and IDs!
const RESOURCE_NAME_TO_ID: Record<string, number> = {
  Stone: 1,
  Coal: 2,
  Wood: 3,
  Copper: 4,
  Ironwood: 5,
  Obsidian: 6,
  Gold: 7,
  Silver: 8,
  Mithral: 9,
  AlchemicalSilver: 10,
  ColdIron: 11,
  DeepCrystal: 12,
  Ruby: 13,
  Diamonds: 14,
  Hartwood: 15,
  Ignium: 16,
  TwilightQuartz: 17,
  TrueIce: 18,
  Adamantine: 19,
  Sapphire: 20,
  EtherealSilica: 21,
  Dragonhide: 22,
  Labor: 23,
  AncientFragment: 24,
  Donkey: 25,
  Knight: 26,
  KnightT2: 27,
  KnightT3: 28,
  Crossbowman: 29,
  CrossbowmanT2: 30,
  CrossbowmanT3: 31,
  Paladin: 32,
  PaladinT2: 33,
  PaladinT3: 34,
  Wheat: 35,
  Fish: 36,
  Lords: 37,
};

interface ResourceTransferItem {
  resourceName: string;
  amount: number;
}

interface TransferOperation { // Renamed from TransferInput for clarity
  fromRealmEntityId: string;
  toRealmEntityId: string;
  resources: ResourceTransferItem[];
}

// Updated to expect an array of transfer operations
type TransferInputArray = TransferOperation[];

const EXAMPLE_JSON_INPUT = JSON.stringify(
  [
    {
      fromRealmEntityId: "from",
      toRealmEntityId: "to",
      resources: [
        { resourceName: "Wood", amount: 50 },
        { resourceName: "ColdIron", amount: 50 },
      ],
    },
    {
      fromRealmEntityId: "from",
      toRealmEntityId: "to",
      resources: [{ resourceName: "Donkey", amount: 10 }],
    },
  ],
  null,
  2
);

export const TransferResourcesScript: React.FC = () => {
  const {
    account: { account },
    setup: { systemCalls },
  } = useDojo();

  // localStorage key for persisting JSON input
  const LOCAL_STORAGE_KEY = 'devtools_transferResourcesJsonInput';

  const [jsonDataInput, setJsonDataInput] = useState<string>(() => {
    const savedJson = localStorage.getItem(LOCAL_STORAGE_KEY);
    return savedJson || EXAMPLE_JSON_INPUT;
  });
  const [isLoading, setIsLoading] = useState(false);

  // Save to localStorage whenever jsonDataInput changes
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, jsonDataInput);
  }, [jsonDataInput]);

  const handleTransfer = useCallback(async () => {
    if (!account || !account.address) {
      return;
    }
    // Check for the send_resources_multiple system call
    if (!systemCalls?.send_resources_multiple) {
      return;
    }

    let parsedInputArray: TransferInputArray;
    try {
      parsedInputArray = JSON.parse(jsonDataInput);
      if (!Array.isArray(parsedInputArray) || parsedInputArray.length === 0) {
        throw new Error("Input must be a non-empty array of transfer operations.");
      }

      for (const operation of parsedInputArray) {
        if (
          !operation.fromRealmEntityId ||
          !operation.toRealmEntityId ||
          !Array.isArray(operation.resources) ||
          operation.resources.length === 0 ||
          operation.resources.some(
            (r) =>
              typeof r.resourceName !== 'string' ||
              !RESOURCE_NAME_TO_ID[r.resourceName] ||
              typeof r.amount !== 'number' ||
              r.amount <= 0
          )
        ) {
          const invalidResources = operation.resources
            .filter(r => typeof r.resourceName !== 'string' || !RESOURCE_NAME_TO_ID[r.resourceName] || typeof r.amount !== 'number' || r.amount <= 0)
            .map(r => `(Name: ${r.resourceName || 'N/A'}, Amount: ${r.amount === undefined ? 'N/A' : r.amount})`)
            .join(", ");
          
          let errorMsg = "Invalid JSON structure or data in one of the operations. ";
          if (!operation.fromRealmEntityId) errorMsg += "Missing 'fromRealmEntityId'. ";
          if (!operation.toRealmEntityId) errorMsg += "Missing 'toRealmEntityId'. ";
          if (!Array.isArray(operation.resources) || operation.resources.length === 0) errorMsg += "Missing or empty 'resources' array. ";
          if (invalidResources) errorMsg += `Invalid resources: ${invalidResources}. Ensure names are correct and amounts positive.`;
          
          throw new Error(errorMsg);
        }
      }

      setIsLoading(true);

      const callsForSystem = parsedInputArray.map((operation, opIndex) => {
        console.log(`TransferResourcesScript: Processing operation ${opIndex}:`, JSON.stringify(operation, null, 2));
        // ... (initial validation for operation properties) ...
        if (
          !operation.fromRealmEntityId ||
          !operation.toRealmEntityId ||
          !Array.isArray(operation.resources) ||
          operation.resources.length === 0 ||
          operation.resources.some(
            (r, rIndex) => {
              const isInvalid = typeof r.resourceName !== 'string' ||
                                !RESOURCE_NAME_TO_ID[r.resourceName] ||
                                typeof r.amount !== 'number' ||
                                r.amount <= 0;
              if (isInvalid) {
                console.error(`TransferResourcesScript: Invalid resource item at operation ${opIndex}, resource ${rIndex}:`, JSON.stringify(r, null, 2));
                console.error(`Details - resourceName type: ${typeof r.resourceName}, name valid: ${!!RESOURCE_NAME_TO_ID[r.resourceName]}, amount type: ${typeof r.amount}, amount > 0: ${r.amount > 0}`);
              }
              return isInvalid;
            }
          )
        ) {
          throw new Error(`Invalid data in operation for sender ${operation.fromRealmEntityId}. Please check all fields.`);
        }

        console.log(`TransferResourcesScript: Inputs for BigInt conversion (op ${opIndex}) - from: '${operation.fromRealmEntityId}', to: '${operation.toRealmEntityId}'`);
        const fromRealmEntityIdBigInt = BigInt(operation.fromRealmEntityId);
        const toRealmEntityIdBigInt = BigInt(operation.toRealmEntityId);

        const resourcesFlatMapped = operation.resources.flatMap((r, rIndex) => {
          const resourceId = RESOURCE_NAME_TO_ID[r.resourceName];
          const amount = r.amount;
          console.log(`TransferResourcesScript: Resource item (op ${opIndex}, res ${rIndex}) - ID_str: '${resourceId}', amount_str: '${amount}'`);
          const resourceIdBigInt = BigInt(resourceId);
          const amountBigIntWithPrecision = BigInt(amount) * BigInt(RESOURCE_PRECISION);
          return [resourceIdBigInt, amountBigIntWithPrecision];
        });

        return {
          sender_entity_id: fromRealmEntityIdBigInt,
          recipient_entity_id: toRealmEntityIdBigInt,
          resources: resourcesFlatMapped
        };
      });

      console.log("TransferResourcesScript: Prepared callsForSystem for system call:", 
        JSON.stringify(callsForSystem, (key, value) => 
          typeof value === 'bigint' ? value.toString() + 'n' : value, 2)
      );

      // Use the send_resources_multiple system call
      await systemCalls.send_resources_multiple({
        signer: account,
        calls: callsForSystem,
      });

    } catch (error) {
      console.error("Error during batch transfer:", error);
    } finally {
      setIsLoading(false);
    }
  }, [account, systemCalls, jsonDataInput]);

  const styles = {
    container: { padding: '10px' },
    title: { margin: '0 0 10px 0' },
    p: { fontSize: '0.85em', marginBottom: '10px' },
    textArea: {
      width: '100%',
      minHeight: '200px',
      padding: '8px',
      border: '1px solid #777',
      borderRadius: '4px',
      backgroundColor: '#222',
      color: 'white',
      fontFamily: 'monospace',
      fontSize: '0.9em',
      boxSizing: 'border-box' as const,
      marginBottom: '10px',
    },
    button: {
      padding: '10px 15px',
      backgroundColor: '#007bff',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '1em',
      opacity: isLoading ? 0.7 : 1,
    },
  };

  // Prepare the display string for resources types
  const resourceTypesDisplayString = `// --- Resource Types ---\n${Object.entries(RESOURCE_NAME_TO_ID)
  .filter(([name, _]) => name !== "None") // Filter out "None"
  .map(([name, _]) => `  ${name}`)
  .join('\n')}`;

  return (
    <div style={styles.container}>
      <h4 style={styles.title}>Transfer resources</h4>
      <p style={styles.p}>
        Input a JSON array of transfer operations.
      </p>
      <textarea
        style={styles.textArea}
        value={jsonDataInput}
        onChange={(e) => setJsonDataInput(e.target.value)}
        placeholder='Enter transfer details as JSON'
      />
      <button
        style={styles.button}
        onClick={handleTransfer}
        disabled={isLoading || !account?.address || !systemCalls?.send_resources_multiple}
      >
        {isLoading ? 'Transferring...' : 'Transfer Resources'}
      </button>
       <pre style={{ fontSize: '0.7em', color: '#ccc', maxHeight: '100px', overflowY: 'auto', background: '#222', padding: '5px', whiteSpace: 'pre-wrap', userSelect: 'text', marginTop: '15px' }}> {/* Ensure whiteSpace and userSelect for copyability, Added marginTop */} 
         {resourceTypesDisplayString}
      </pre>
    </div>
  );
}; 