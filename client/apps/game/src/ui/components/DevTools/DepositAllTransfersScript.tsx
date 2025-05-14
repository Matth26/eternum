import Button from "@/ui/elements/button";
import { getBlockTimestamp } from "@/utils/timestamp";
import { ResourceArrivalManager } from "@bibliothecadao/eternum";
import { useDojo, usePlayerStructures } from "@bibliothecadao/react";
import { Resource, ResourceArrivalInfo, StructureType } from "@bibliothecadao/types";
import { getComponentValue } from "@dojoengine/recs";
import React, { useState } from "react";

export const DepositAllTransfersScript: React.FC = () => {
  const {
    account: { account },
    setup: { components, systemCalls },
  }: any = useDojo();

  const playerStructures: any[] = usePlayerStructures();
  const [isLoading, setIsLoading] = useState(false);
  // Messages state removed, will use console.log

  const playerRealms = playerStructures.filter(
    (structure: any) => structure.category === StructureType.Realm,
  );

  const executeDeposits = async () => {
    if (!account) {
      console.error("Account not available.");
      return;
    }
    setIsLoading(true);
    console.log("Starting deposit process...");
    let totalSuccessCount = 0;
    let totalErrorCount = 0;
    const { currentBlockTimestamp } = getBlockTimestamp();

    if (!components.ResourceArrival) {
        console.error("ResourceArrival component not found in setup.");
        setIsLoading(false);
        return;
    }
    const allRawArrivalComponents = Array.from(components.ResourceArrival.entities()).map((entityId: any) => {
        return getComponentValue(components.ResourceArrival, entityId);
    }).filter(Boolean); // Filter out any undefined components
    
    console.log(`Found ${allRawArrivalComponents.length} total ResourceArrival components in the game.`);
    if (allRawArrivalComponents.length > 0) {
        console.log("Sample raw arrival components (up to 3):", allRawArrivalComponents.slice(0, 3));
    }

    for (const realm of playerRealms) {
        console.log(`Processing realm: ${realm.name || realm.entityId} (Realm Entity ID: ${realm.entityId})`);
        
        const realmEntityId = realm.entityId; 

        const arrivalsForThisRealm = allRawArrivalComponents
            .filter((rawArrivalComponent: any) => {
                // Ensure structure_id is treated as a number for comparison, like realm.entityId
                return Number(rawArrivalComponent.structure_id) === Number(realmEntityId);
            });

        if (!arrivalsForThisRealm || arrivalsForThisRealm.length === 0) {
            console.log(`No ResourceArrival component instances found for realm ID: ${realmEntityId}.`);
            continue;
        }
        
        console.log(`Found ${arrivalsForThisRealm.length} ResourceArrival component instance(s) for realm: ${realm.name || realm.entityId}.`);

        for (const rawArrival of arrivalsForThisRealm) {
            if (!rawArrival) continue;
            console.log(`Inspecting raw arrival for realm ${realmEntityId}, day ${rawArrival.day}:`, rawArrival);

            for (let slotNum = 1; slotNum <= 24; slotNum++) {
                const slotKey = `slot_${slotNum}` as keyof typeof rawArrival;
                const slotData = rawArrival[slotKey] as any[];

                if (slotData && slotData.length > 0) {
                    console.log(`Found resources in day ${rawArrival.day}, slot ${slotNum} for realm ${realmEntityId}`);
                    let resourcesInSlot: Resource[] = [];
                    try {
                        for (const item of slotData) {
                            if (item && item.length === 2 && item[0] && item[1]) {
                                const resourceId = Number(item[0].value); // item[0] is {type: 'primitive', type_name: 'u8', value: 36, key: false}
                                const amount = Number(BigInt(item[1].value)); // item[1] is {type: 'primitive', type_name: 'u128', value: '0x...', key: false}
                                resourcesInSlot.push({ resourceId, amount });
                            } else {
                                console.warn(`Malformed resource item in slot ${slotNum}, day ${rawArrival.day} for realm ${realmEntityId}:`, item);
                            }
                        }
                    } catch (e: any) {
                        console.error(`Error processing resources in slot ${slotNum}, day ${rawArrival.day} for realm ${realmEntityId}: ${e.message}`, slotData);
                        totalErrorCount++;
                        continue; // Skip this slot if malformed
                    }

                    if (resourcesInSlot.length > 0) {
                        const arrivalInfo: ResourceArrivalInfo = {
                            structureEntityId: Number(rawArrival.structure_id),
                            day: Number(rawArrival.day),
                            slot: slotNum,
                            arrivesAt: 0, // Placeholder - system call will validate day/slot
                            resources: resourcesInSlot,
                        } as ResourceArrivalInfo;
                        
                        console.log(`Attempting to offload for realm ${realmEntityId}, day ${arrivalInfo.day}, slot ${arrivalInfo.slot} with ${arrivalInfo.resources.length} resource types.`);
                        console.log("ArrivalInfo being sent to manager:", arrivalInfo);

                        try {
                            const manager = new ResourceArrivalManager(components, systemCalls, arrivalInfo);
                            await manager.offload(account, arrivalInfo.resources.length); // Pass the count of distinct resources
                            console.log(`Successfully offloaded resources for realm ${realmEntityId}, day ${arrivalInfo.day}, slot ${arrivalInfo.slot}.`);
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

    console.log(`All realms processed. Total Successes: ${totalSuccessCount}, Total Errors: ${totalErrorCount}.`);
    setIsLoading(false);
  };

  return (
    React.createElement("div", null,
      React.createElement("h3", null, "Deposit All Ready Transfers"),
      React.createElement(Button, { onClick: executeDeposits, isLoading: isLoading, disabled: isLoading || playerRealms.length === 0 },
        isLoading ? "Processing..." : `Deposit All for ${playerRealms.length} Realm(s)`
      )
      // Removed the message log div area
    )
  );
};
