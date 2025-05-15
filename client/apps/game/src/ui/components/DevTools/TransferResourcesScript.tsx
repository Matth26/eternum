import Button from "@/ui/elements/button";
import { ResourceArrivalManager } from "@bibliothecadao/eternum";
import { useDojo, usePlayerStructures } from "@bibliothecadao/react";
import { Resource, RESOURCE_PRECISION, ResourceArrivalInfo, StructureType } from "@bibliothecadao/types";
import { getComponentValue } from "@dojoengine/recs";
import React, { useCallback, useEffect, useState } from 'react';

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

interface TransferOperation {
  fromRealmEntityId: string;
  toRealmEntityId: string;
  resources: ResourceTransferItem[];
}

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
    setup: { components, systemCalls },
  } = useDojo();

  const LOCAL_STORAGE_KEY = 'devtools_transferResourcesJsonInput';
  const [jsonDataInput, setJsonDataInput] = useState<string>(() => {
    const savedJson = localStorage.getItem(LOCAL_STORAGE_KEY);
    return savedJson || EXAMPLE_JSON_INPUT;
  });
  const [isLoading, setIsLoading] = useState(false);

  const playerStructures: any[] = usePlayerStructures();
  const playerRealms = playerStructures.filter(
    (structure: any) => structure.category === StructureType.Realm,
  );

  const executeDeposits = async () => {
    if (!account) {
      console.error("Account not available for deposits.");
      return;
    }
    setIsLoading(true);
    console.log("Starting deposit all process...");
    let totalSuccessCount = 0;
    let totalErrorCount = 0;

    if (!components.ResourceArrival) {
        console.error("ResourceArrival component not found in setup.");
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
                            console.log(`Successfully offloaded for realm ${realmEntityId}, day ${arrivalInfo.day}, slot ${arrivalInfo.slot}.`);
                            totalSuccessCount++;
                        } catch (e: any) {
                            console.error(`Error offloading for realm ${realmEntityId}, day ${arrivalInfo.day}, slot ${arrivalInfo.slot}: ${e.message}`);
                            totalErrorCount++;
                        }
                    }
                }
            }
        }
    }
    console.log(`Deposit all process finished. Successes: ${totalSuccessCount}, Errors: ${totalErrorCount}.`);
    setIsLoading(false);
  };

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, jsonDataInput);
  }, [jsonDataInput]);

  const handleTransfer = useCallback(async () => {
    if (!account || !account.address) {
      console.error("Account not available for transfers.");
      return;
    }
    if (!systemCalls?.send_resources_multiple) {
      console.error("System call send_resources_multiple not available.");
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

      await systemCalls.send_resources_multiple({
        signer: account,
        calls: callsForSystem,
      });
      console.log("Batch transfer successful!");

    } catch (error) {
      console.error("Error during batch resource transfer:", error);
    } finally {
      setIsLoading(false);
    }
  }, [account, systemCalls, jsonDataInput, components]);

  const styles: {[key: string]: React.CSSProperties } = {
    title: { margin: '0 0 10px 0' },
    p: { fontSize: '0.85em', marginBottom: '10px' },
    textArea: {
      width: '100%',
      minHeight: '5%',
      margin: '6px 0',
      padding: '6px',
      border: '1px solid #777',
      borderRadius: '4px',
      backgroundColor: '#222',
      color: 'white',
      fontFamily: 'monospace',
      fontSize: '0.85em',
      boxSizing: 'border-box',
    },
    button: {
      padding: '6px 12px',
      margin: '0 6px 6px 0',
      backgroundColor: '#007bff',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '0.95em',
      opacity: isLoading ? 0.7 : 1,
    },
    buttonContainer: { display: 'flex', gap: '10px', marginBottom: '10px' },
  };


  return (
    React.createElement("div", { style: styles.container },
      React.createElement("textarea", {
        style: styles.textArea,
        value: jsonDataInput,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setJsonDataInput(e.target.value),
        placeholder: 'Enter transfer details as JSON'
      }),
      React.createElement("div", { style: styles.buttonContainer },
        React.createElement(Button, {
          style:styles.button,
          onClick: handleTransfer,
          disabled: isLoading || !account?.address || !systemCalls?.send_resources_multiple,
          children: isLoading ? 'Processing...' : 'Transfer resources'
        }),
        React.createElement(Button, {
          style: {...styles.button, backgroundColor: '#28a745'},
          onClick: executeDeposits,
          disabled: isLoading || !account?.address || playerRealms.length === 0,
          children: isLoading ? 'Processing...' : `Deposit all`
        })
      )
    )
  );
}; 