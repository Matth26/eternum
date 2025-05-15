import { ResourceArrivalManager } from "@bibliothecadao/eternum";
import { useDojo, usePlayerStructures } from "@bibliothecadao/react";
import { Resource, RESOURCE_PRECISION, ResourceArrivalInfo, StructureType } from "@bibliothecadao/types";
import { getComponentValue } from "@dojoengine/recs";
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

interface TransferResourcesScriptProps {
  log: (message: string, type?: 'info' | 'error' | 'success', script?: string) => void;
}

export const TransferResourcesScript: React.FC<TransferResourcesScriptProps> = ({ log }) => {
  const {
    account: { account },
    setup: { components, systemCalls },
  } = useDojo();

  // localStorage key for persisting JSON input
  const LOCAL_STORAGE_KEY = 'devtools_transferResourcesJsonInput';

  const [jsonDataInput, setJsonDataInput] = useState<string>(() => {
    const savedJson = localStorage.getItem(LOCAL_STORAGE_KEY);
    return savedJson || EXAMPLE_JSON_INPUT;
  });
  const [isLoading, setIsLoading] = useState(false);

  // --- Logic from DepositAllTransfersScript --- 
  const playerStructures: any[] = usePlayerStructures();
  const playerRealms = playerStructures.filter(
    (structure: any) => structure.category === StructureType.Realm,
  );

  const executeDeposits = async () => {
    if (!account) {
      log("Account not available for deposits.", 'error', 'TransferResources');
      return;
    }
    setIsLoading(true);
    log("Starting deposit all process...", 'info', 'TransferResources');
    let totalSuccessCount = 0;
    let totalErrorCount = 0;

    if (!components.ResourceArrival) {
        log("ResourceArrival component not found in setup.", 'error', 'TransferResources');
        setIsLoading(false);
        return;
    }
    const allRawArrivalComponents = Array.from(components.ResourceArrival.entities()).map((entityId: any) => {
        return getComponentValue(components.ResourceArrival, entityId);
    }).filter(Boolean);
    
    for (const realm of playerRealms) {
        const realmEntityId = realm.entityId;
        const arrivalsForThisRealm = allRawArrivalComponents
            .filter((rawArrivalComponent: any) => Number(rawArrivalComponent.structure_id) === Number(realmEntityId));

        if (!arrivalsForThisRealm || arrivalsForThisRealm.length === 0) {
            continue;
        }
        
        for (const rawArrival of arrivalsForThisRealm) {
            if (!rawArrival) continue;

            for (let slotNum = 1; slotNum <= 24; slotNum++) {
                const slotKey = `slot_${slotNum}` as keyof typeof rawArrival;
                const slotData = rawArrival[slotKey] as any[];

                if (slotData && slotData.length > 0) {
                    let resourcesInSlot: Resource[] = [];
                    try {
                        for (const item of slotData) {
                            if (item && item.length === 2 && item[0] && item[1]) {
                                const resourceId = Number(item[0].value);
                                const amount = Number(BigInt(item[1].value)); 
                                resourcesInSlot.push({ resourceId, amount });
                            }
                        }
                    } catch (e: any) {
                        totalErrorCount++;
                        continue;
                    }

                    if (resourcesInSlot.length > 0) {
                        const arrivalInfo: ResourceArrivalInfo = {
                            structureEntityId: Number(rawArrival.structure_id),
                            day: rawArrival.day,
                            slot: BigInt(slotNum),
                            arrivesAt: 0n,
                            resources: resourcesInSlot,
                        } as ResourceArrivalInfo;
                        
                        try {
                            const manager = new ResourceArrivalManager(components, systemCalls, arrivalInfo);
                            await manager.offload(account, arrivalInfo.resources.length);
                            log(`Successfully offloaded for realm ${realmEntityId}, day ${arrivalInfo.day}, slot ${arrivalInfo.slot}.`, 'success', 'TransferResources');
                            totalSuccessCount++;
                        } catch (e: any) {
                            log(`Error offloading for realm ${realmEntityId}, day ${arrivalInfo.day}, slot ${arrivalInfo.slot}: ${e.message}`, 'error', 'TransferResources');
                            totalErrorCount++;
                        }
                    }
                }
            }
        }
    }
    log(`Deposit all process finished. Successes: ${totalSuccessCount}, Errors: ${totalErrorCount}.`, 'info', 'TransferResources');
    setIsLoading(false);
  };
  // --- End of logic from DepositAllTransfersScript ---

  // Save to localStorage whenever jsonDataInput changes
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, jsonDataInput);
  }, [jsonDataInput]);

  const handleTransfer = useCallback(async () => {
    if (!account || !account.address) {
      log("Account not available for transfers.", 'error', 'TransferResources');
      return;
    }
    if (!systemCalls?.send_resources_multiple) {
      log("System call send_resources_multiple not available.", 'error', 'TransferResources');
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
        log(`TransferResourcesScript: Processing operation ${opIndex}: ${JSON.stringify(operation, null, 2)}`, 'info', 'TransferResources');
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
                log(`Invalid resource at index ${rIndex} in operation ${opIndex}.`, 'error', 'TransferResources');
              }
              return isInvalid;
            }
          )
        ) {
          return null;
        }
        return {
          from_entity_id: operation.fromRealmEntityId,
          to_entity_id: operation.toRealmEntityId,
          resource_types: operation.resources.map(r => RESOURCE_NAME_TO_ID[r.resourceName]),
          resource_amounts: operation.resources.map(r => r.amount * RESOURCE_PRECISION),
        };
      }).filter(Boolean);

      if (callsForSystem.length === 0) {
        log("No valid transfer operations to execute.", 'error', 'TransferResources');
        setIsLoading(false);
        return;
      }

      await systemCalls.send_resources_multiple({
        signer: account,
        calls: callsForSystem,
      });
      log(`Successfully executed ${callsForSystem.length} transfer operation(s).`, 'success', 'TransferResources');
    } catch (error) {
      log(`Error during transfer: ${(error as Error).message}`, 'error', 'TransferResources');
    } finally {
      setIsLoading(false);
    }
  }, [account, systemCalls, jsonDataInput, log]);

  const buttonStyle: React.CSSProperties = {
    padding: '6px 12px',
    margin: '0 6px 6px 0',
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
    minHeight: '80px',
    margin: '6px 0',
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
        style={textAreaStyle}
        value={jsonDataInput}
        onChange={e => setJsonDataInput(e.target.value)}
        placeholder={'Paste transfer JSON here...'}
        disabled={isLoading}
      />
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
        <button
          style={buttonStyle}
          onClick={handleTransfer}
          disabled={isLoading || !account?.address || !systemCalls?.send_resources_multiple}
        >
          {isLoading ? 'Transferring...' : 'Transfer'}
        </button>
        <button
          style={{ ...buttonStyle, backgroundColor: '#28a745' }}
          onClick={executeDeposits}
          disabled={isLoading || !account?.address}
        >
          {isLoading ? 'Depositing...' : 'Deposit All'}
        </button>
      </div>
    </div>
  );
}; 