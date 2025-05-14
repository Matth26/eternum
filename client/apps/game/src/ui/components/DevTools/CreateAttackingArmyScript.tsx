import { getBlockTimestamp } from "@/utils/timestamp";
import {
  ArmyManager,
  divideByPrecision,
  getBalance,
  getOffchainRealm,
  getTroopResourceId
} from "@bibliothecadao/eternum";
import { useDojo } from "@bibliothecadao/react";
import { getTilesFromToriiClient } from "@bibliothecadao/torii-client";
import {
  Direction,
  getDirectionBetweenAdjacentHexes,
  getNeighborHexes,
  ID,
  StructureType,
  TroopTier,
  TroopType,
} from "@bibliothecadao/types";
import { getComponentValue, Has, runQuery } from "@dojoengine/recs";
import React, { useCallback, useState } from 'react';

interface OwnedRealmInfo {
  name: string;
  entityId: ID;
  coord: { x: number; y: number };
}

const TROOP_TYPES_TO_CHECK = [TroopType.Crossbowman, TroopType.Knight, TroopType.Paladin];
const TROOP_TIERS_TO_CHECK = [TroopTier.T3, TroopTier.T2, TroopTier.T1]; // Prioritize higher tiers

export const CreateAttackingArmyScript: React.FC = () => {
  const {
    account: { account },
    setup: { components, systemCalls, network: { toriiClient } },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);

  const log = (message: string) => {
    console.log(message);
  };

  const handleCreateArmies = useCallback(async () => {
    if (!account || !account.address) {
      log("Error: Account address not available. Please connect wallet.");
      return;
    }
    if (!components?.Structure || !components?.ExplorerTroops || !components?.Resource) {
      log("Error: Required components not available in Dojo setup.");
      return;
    }

    setIsLoading(true);
    log('Starting to create attacking armies for your realms...');

    try {
      // 1. Fetch Owned Realms
      const ownedRealms: OwnedRealmInfo[] = [];
      const structureEntities = runQuery([Has(components.Structure)]);

      for (const entityIdValue of structureEntities) {
        const structure = getComponentValue(components.Structure, entityIdValue);
        if (structure && structure.owner) {
          const ownerAddressHex = "0x" + structure.owner.toString(16);
          if (ownerAddressHex.toLowerCase() === account.address.toLowerCase()) {
            if (Number(structure.category) === StructureType.Realm) {
              let name = "Unknown Realm";
              const originalRealmIdForName = Number(structure.metadata?.realm_id);
              if (!isNaN(originalRealmIdForName) && originalRealmIdForName !== 0) {
                const offchainData = getOffchainRealm(originalRealmIdForName);
                name = offchainData ? offchainData.name : `Realm ${originalRealmIdForName}`;
              } else {
                name = `Realm (ID: ${structure.entity_id?.toString()})`;
              }
              ownedRealms.push({
                name,
                entityId: structure.entity_id,
                coord: { x: structure.base.coord_x, y: structure.base.coord_y },
              });
            }
          }
        }
      }

      if (ownedRealms.length === 0) {
        log('No owned Realms found.');
        setIsLoading(false);
        return;
      }

      log(`Found ${ownedRealms.length} owned realm(s). Processing each...`);

      for (const realm of ownedRealms) {
        log(`Processing Realm: ${realm.name} (ID: ${realm.entityId}) at [${realm.coord.x}, ${realm.coord.y}]`);
        let armyCreatedForThisRealm = false;

        // 2. Find a Free Spawn Direction
        const neighborHexes = getNeighborHexes(realm.coord.x, realm.coord.y);
        const neighborTilesInfo = await getTilesFromToriiClient(
          toriiClient,
          neighborHexes.map((coord) => ({ col: coord.col, row: coord.row })),
        );

        let spawnDirection: Direction | null = null;
        for (const tile of neighborTilesInfo) {
          if (tile.occupier_id === 0) { // Hex is empty
            const direction = getDirectionBetweenAdjacentHexes(
              { col: realm.coord.x, row: realm.coord.y },
              { col: tile.col, row: tile.row },
            );
            if (direction !== null) {
              spawnDirection = direction;
              log(`Found free spawn hex at [${tile.col}, ${tile.row}], direction: ${Direction[spawnDirection]}`);
              break;
            }
          }
        }

        if (spawnDirection === null) {
          log(`No free adjacent hex found to spawn army for Realm ${realm.name}. Skipping.`);
          continue;
        }

        // 3. Iterate Through Troop Types and Tiers
        for (const troopType of TROOP_TYPES_TO_CHECK) {
          if (armyCreatedForThisRealm) break;
          for (const troopTier of TROOP_TIERS_TO_CHECK) {
            if (armyCreatedForThisRealm) break;

            log(`Checking ${TroopType[troopType]} T${troopTier + 1} for Realm ${realm.name}...`);
            const resourceId = getTroopResourceId(troopType, troopTier);
            const { currentDefaultTick } = getBlockTimestamp();
            
            const balanceComponent = getBalance(realm.entityId, resourceId, currentDefaultTick, components);
            const troopResourceBalance = balanceComponent ? balanceComponent.balance : 0n;
            
            // This gives the actual number of troops, not the precision-multiplied value
            const affordableTroopCount = divideByPrecision(Number(troopResourceBalance));

            if (affordableTroopCount > 0) {
              log(`Found resources for ${affordableTroopCount} ${TroopType[troopType]} T${troopTier + 1} in Realm ${realm.name}.`);
              
              try {
                const armyManager = new ArmyManager(systemCalls, components, realm.entityId);
                log(`Attempting to create army with ${affordableTroopCount} ${TroopType[troopType]} T${troopTier + 1}...`);

                // createExplorerArmy expects a non-precision-multiplied count.
                // It handles multiplyByPrecision internally.
                await armyManager.createExplorerArmy(
                  account,
                  troopType,
                  troopTier,
                  affordableTroopCount, 
                  spawnDirection
                );
                log(`Successfully initiated transaction to create ${TroopType[troopType]} T${troopTier + 1} army for Realm ${realm.name}.`);
                armyCreatedForThisRealm = true; 
              } catch (e) {
                log(`Error creating army for Realm ${realm.name}: ${(e as Error).message}`);
              }
              break; // Break from tier loop once an army is created or an attempt is made
            } else {
              // log(`No resources for ${TroopType[troopType]} T${troopTier+1} in Realm ${realm.name}.`);
            }
          }
        }
        if (!armyCreatedForThisRealm) {
          log(`No troop resources found or army creation failed for Realm ${realm.name}.`);
        }
      }
      log('Finished processing all realms.');
    } catch (error) {
      log(`An unexpected error occurred: ${(error as Error).message}`);
      console.error("Error creating armies:", error);
    } finally {
      setIsLoading(false);
    }
  }, [account, components, systemCalls, toriiClient]);

  const buttonStyle: React.CSSProperties = {
    padding: '10px 15px',
    margin: '10px 0',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1em',
    opacity: isLoading ? 0.7 : 1,
  };

  return (
    <div>
      <h4>Create attacking Army in all realms</h4>
      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
        This script will attempt to create one attacking army in each of your realms.
        It will spawn in the first available adjacent hex.
      </p>
      <button
        style={buttonStyle}
        onClick={handleCreateArmies}
        disabled={isLoading || !account?.address}
      >
        {isLoading ? 'Creating Armies...' : 'Create All Realm Armies'}
      </button>
    </div>
  );
}; 