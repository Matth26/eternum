import { ClientConfigManager } from '@bibliothecadao/eternum';
import { useDojo, useExplorersByStructure, usePlayerStructures } from '@bibliothecadao/react';
import { getTilesFromToriiClient } from "@bibliothecadao/torii-client";
import { BiomeType, getDirectionBetweenAdjacentHexes, getNeighborHexes, ID, StructureType, TroopTier, TroopType } from '@bibliothecadao/types';
import { getComponentValue, Has, runQuery } from '@dojoengine/recs';
import React, { useCallback, useEffect, useState } from 'react';
import { normalizedToContractCoords } from '../settlement/settlement-utils';

// Module-scoped variables for persistence across remounts (without localStorage)
let persistedInputX: string = "";
let persistedInputY: string = "";

// Add these style variables near the top, after imports
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '2px', fontSize: '0.9em' };
const selectStyle: React.CSSProperties = { marginLeft: 8, background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: '4px 8px' };
const optionStyle: React.CSSProperties = { background: '#222', color: '#fff' };

interface AutoExploreArmiesScriptProps {
  log: (message: string, type?: 'info' | 'error' | 'success', script?: string) => void;
}

export const AutoExploreArmiesScript: React.FC<AutoExploreArmiesScriptProps> = ({ log }: AutoExploreArmiesScriptProps) => {
  const {
    account: { account },
    setup: { components, systemCalls, network: { toriiClient } },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);
  // Initialize state from module-scoped variables
  const [inputX, setInputX] = useState<string>(persistedInputX);
  const [inputY, setInputY] = useState<string>(persistedInputY);

  // Effect to update module-scoped variables when state changes
  useEffect(() => {
    persistedInputX = inputX;
  }, [inputX]);

  useEffect(() => {
    persistedInputY = inputY;
  }, [inputY]);

  // Use the hook to get all player structures
  const playerStructures = usePlayerStructures();
  // Combine all explorers from all player structures
  const allPlayerArmies = playerStructures
    .flatMap((structure: any) => {
      const armies = useExplorersByStructure({ structureEntityId: structure.entityId });
      return armies;
    })
    .filter((army: any) => army && army.position && typeof army.position.x === 'number' && typeof army.position.y === 'number');

  const handleAutoExplore = useCallback(async () => {
    if (!account || !components || !systemCalls || !toriiClient) {
      log('Dojo setup not ready or account not available.', 'error', 'AutoExploreArmies');
      return;
    }
    setIsLoading(true);
    try {
      // Get contract coordinates from user input
      const { x: targetX, y: targetY } = normalizedToContractCoords(inputX, inputY);
      log(`Target contract coordinates: (${targetX}, ${targetY})`, 'info', 'AutoExploreArmies');
      // 1. Fetch all owned realms
      const ownedRealms: { entityId: ID; coord: { x: number; y: number }; name: string }[] = [];
      const structureEntities = runQuery([Has(components.Structure)]);
      for (const entityId of structureEntities) {
        const structure = getComponentValue(components.Structure, entityId);
        if (structure && structure.owner && BigInt(structure.owner) === BigInt(account.address)) {
          if (Number(structure.category) === StructureType.Realm) {
            ownedRealms.push({
              entityId: structure.entity_id,
              coord: { x: structure.base.coord_x, y: structure.base.coord_y },
              name: `Realm ${structure.entity_id}`,
            });
          }
        }
      }
      if (ownedRealms.length === 0) {
        log('No owned realms found.', 'error', 'AutoExploreArmies');
        setIsLoading(false);
        return;
      }
      if (allPlayerArmies.length === 0) {
        log('No player armies found.', 'error', 'AutoExploreArmies');
        setIsLoading(false);
        return;
      }
      // --- Gather all unique neighbor positions ---
      const allNeighborPositions: { col: number; row: number }[] = [];
      for (const army of allPlayerArmies) {
        const neighbors = getNeighborHexes(army.position.x, army.position.y);
        for (const neighbor of neighbors) {
          allNeighborPositions.push({ col: neighbor.col, row: neighbor.row });
        }
      }
      const uniqueNeighborPositions = Array.from(
        new Set(allNeighborPositions.map(pos => `${pos.col},${pos.row}`))
      ).map(key => {
        const [col, row] = key.split(',').map(Number);
        return { col, row };
      });
      // --- Fetch all tiles from Torii ---
      const tiles = await getTilesFromToriiClient(toriiClient, uniqueNeighborPositions);
      const tileMap = new Map<string, any>();
      for (const tile of tiles) {
        tileMap.set(`${tile.col},${tile.row}`, tile);
      }
      // 4. For each army, find empty adjacent tile closest to target and explore
      const exploredTargets = new Set<string>();
      // Get config manager instance
      const configManager = ClientConfigManager.instance();

      // Helper for JSON.stringify to handle BigInts
      const bigIntReplacer = (key: string, value: any) =>
        typeof value === 'bigint' ? value.toString() + "n" : value;

      for (const army of allPlayerArmies) {
        // Ensure army and nested properties exist
        if (!army || !army.troops || !army.troops.stamina || typeof army.troops.stamina.amount !== 'bigint') {
          log(`Army ${army?.entityId || 'Unknown ID'} missing required stamina data. Skipping.`, 'error', 'AutoExploreArmies');
          continue;
        }
        // Updated check for troop category
        if (typeof army.troops.category !== 'string' || !army.troops.category) { 
          log(`Army ${army.entityId} missing or invalid troop category (not a non-empty string). typeof: ${typeof army.troops.category}, value: '${army.troops.category}'. Skipping.`, 'error', 'AutoExploreArmies');
          // Removed debug log for army.troops
          continue;
        }
        // Check for troop tier
        if (typeof army.troops.tier !== 'string' || !army.troops.tier) {
          log(`Army ${army.entityId} missing or invalid troop tier (not a non-empty string). typeof: ${typeof army.troops.tier}, value: '${army.troops.tier}'. Skipping.`, 'error', 'AutoExploreArmies');
          continue;
        }

        const neighbors = getNeighborHexes(army.position.x, army.position.y);
        // First pass: unexplored
        let bestTile = null;
        let bestDist = Infinity;
        for (const neighbor of neighbors) {
          let occupied = false;
          for (const otherArmy of allPlayerArmies) {
            if (otherArmy.position.x === neighbor.col && otherArmy.position.y === neighbor.row) {
              occupied = true;
              break;
            }
          }
          if (!occupied) {
            for (const realm of ownedRealms) {
              if (realm.coord.x === neighbor.col && realm.coord.y === neighbor.row) {
                occupied = true;
                break;
              }
            }
          }
          const tile = tileMap.get(`${neighbor.col},${neighbor.row}`);
          if (!occupied && tile && tile.biome !== 0) {
            occupied = true;
            // skip for first pass
          }
          if (!occupied) {
            const targetKey = `${neighbor.col},${neighbor.row}`;
            if (exploredTargets.has(targetKey)) {
              occupied = true;
            }
          }
          if (!occupied) {
            const dist = Math.abs(neighbor.col - targetX) + Math.abs(neighbor.row - targetY);
            if (dist < bestDist) {
              bestDist = dist;
              bestTile = neighbor;
            }
          }
        }
        // Second pass: explored but unoccupied
        let fallbackTile = null;
        let fallbackDist = Infinity;
        if (!bestTile) {
          for (const neighbor of neighbors) {
            let occupied = false;
            for (const otherArmy of allPlayerArmies) {
              if (otherArmy.position.x === neighbor.col && otherArmy.position.y === neighbor.row) {
                occupied = true;
                break;
              }
            }
            if (!occupied) {
              for (const realm of ownedRealms) {
                if (realm.coord.x === neighbor.col && realm.coord.y === neighbor.row) {
                  occupied = true;
                  break;
                }
              }
            }
            const tile = tileMap.get(`${neighbor.col},${neighbor.row}`);
            if (!occupied && tile && tile.biome !== 0 && tile.occupier_id === 0) {
              const targetKey = `${neighbor.col},${neighbor.row}`;
              if (!exploredTargets.has(targetKey)) {
                const dist = Math.abs(neighbor.col - targetX) + Math.abs(neighbor.row - targetY);
                if (dist < fallbackDist) {
                  fallbackDist = dist;
                  fallbackTile = neighbor;
                }
              }
            }
          }
        }
        let moveTile = bestTile || fallbackTile;
        let moveExplore = !!bestTile;

        if (moveTile) {
          const targetTileInfo = tileMap.get(`${moveTile.col},${moveTile.row}`);
          const targetBiome = targetTileInfo?.biome as BiomeType | undefined; // Assuming biome is part of tile info

          // Determine stamina cost
          let requiredStamina = 0;
          // army.troops.category is a string like "Knight", "Paladin", etc.
          const armyTroopType = army.troops.category as TroopType; 
          // army.troops.tier is a string like "T1", "T2", etc.
          const armyTroopTier = army.troops.tier as TroopTier;

          if (moveExplore) {
            requiredStamina = configManager.getExploreStaminaCost();
          } else if (targetBiome !== undefined) {
            // Check if armyTroopType string is a valid value in the TroopType enum
            if (Object.values(TroopType).includes(armyTroopType) && Object.values(TroopTier).includes(armyTroopTier)) {
               requiredStamina = configManager.getTravelStaminaCost(targetBiome, armyTroopType);
            } else {
               log(`Army ${army.entityId} has an unrecognized troop category ('${army.troops.category}') or tier ('${army.troops.tier}') for travel stamina calculation. Skipping.`, 'error', 'AutoExploreArmies');
               continue;
            }
          } else {
            log(`Could not determine biome for tile (${moveTile.col},${moveTile.row}) for army ${army.entityId}. Skipping stamina check / move.`, 'error', 'AutoExploreArmies');
            continue; // Skip if biome can't be determined for travel cost
          }

          // Get initial stamina from config
          let staminaInitial = 0;
          if (Object.values(TroopType).includes(armyTroopType) && Object.values(TroopTier).includes(armyTroopTier)) {
            const troopStaminaConfig = configManager.getTroopStaminaConfig(armyTroopType, armyTroopTier);
            staminaInitial = troopStaminaConfig.staminaInitial;
          } else {
            log(`Army ${army.entityId} could not get troopStaminaConfig due to unrecognized category ('${army.troops.category}') or tier ('${army.troops.tier}'). Assuming 0 initial stamina.`, 'info', 'AutoExploreArmies');
            // Continue with staminaInitial = 0 if config can't be fetched, or handle as error
          }

          const currentRawStamina = army.troops.stamina.amount;
          const effectiveCurrentStamina = currentRawStamina + BigInt(staminaInitial);

          log(`Army ${army.entityId}: Effective Stamina: ${effectiveCurrentStamina} (Raw: ${currentRawStamina}, Initial: ${staminaInitial}), Required: ${requiredStamina} for ${moveExplore ? 'exploring' : 'moving to'} (${moveTile.col},${moveTile.row})`, 'info', 'AutoExploreArmies');


          if (effectiveCurrentStamina < BigInt(requiredStamina)) {
            log(`Army ${army.entityId} has insufficient effective stamina (${effectiveCurrentStamina}) to ${moveExplore ? 'explore' : 'move'} (requires ${requiredStamina}). Skipping.`, 'info', 'AutoExploreArmies');
            continue;
          }

          exploredTargets.add(`${moveTile.col},${moveTile.row}`);
          try {
            log(`Army ${army.entityId} at (${army.position.x},${army.position.y}) trying to move to (${moveTile.col},${moveTile.row})`, 'info', 'AutoExploreArmies');
            const direction = getDirectionBetweenAdjacentHexes(
              { col: army.position.x, row: army.position.y },
              { col: moveTile.col, row: moveTile.row }
            );
            if (direction == null) {
              log(`Could not determine direction for army ${army.entityId} to move (${moveTile.col},${moveTile.row})`, 'error', 'AutoExploreArmies');
              continue;
            }
            await systemCalls.explorer_move({
              signer: account,
              explorer_id: army.entityId,
              directions: [direction],
              explore: moveExplore,
            });
            log(`Army ${army.entityId} ${moveExplore ? 'explored' : 'moved to'} tile (${moveTile.col},${moveTile.row})`, 'success', 'AutoExploreArmies');
          } catch (e) {
            log(`Failed to move with army ${army.entityId}: ${(e as Error).message}`, 'error', 'AutoExploreArmies');
          }
        } else {
          log(`No available adjacent tile to move for army ${army.entityId} at (${army.position.x},${army.position.y})`, 'info', 'AutoExploreArmies');
        }
      }
      log('Auto-explore process complete.', 'success', 'AutoExploreArmies');
    } catch (error) {
      log(`Unexpected error: ${(error as Error).message}`, 'error', 'AutoExploreArmies');
    }
    setIsLoading(false);
  }, [account, components, systemCalls, toriiClient, log, allPlayerArmies, playerStructures, inputX, inputY]);

  const buttonStyle: React.CSSProperties = {
    padding: '10px 15px',
    margin: '0 0 10px 0',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1em',
    opacity: isLoading ? 0.7 : 1,
  };

  return (
    <div style={{ fontFamily: 'monospace', padding: 0, border: 'none', margin: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: '16px' }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>
          <span style={{ marginRight: 6 }}>Target X:</span>
          <input
            type="number"
            value={inputX}
            onChange={e => setInputX(e.target.value)}
            style={{
              background: '#222',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: 4,
              padding: '4px 8px',
              width: 80,
              fontSize: '1em',
              marginLeft: 0,
            }}
            placeholder="e.g. -72"
          />
        </label>
        <label style={{ ...labelStyle, marginBottom: 0 }}>
          <span style={{ marginRight: 6 }}>Target Y:</span>
          <input
            type="number"
            value={inputY}
            onChange={e => setInputY(e.target.value)}
            style={{
              background: '#222',
              color: '#fff',
              border: '1px solid #444',
              borderRadius: 4,
              padding: '4px 8px',
              width: 80,
              fontSize: '1em',
              marginLeft: 0,
            }}
            placeholder="e.g. 15"
          />
        </label>
      </div>
      <button
        style={buttonStyle}
        onClick={handleAutoExplore}
        disabled={isLoading || !account?.address}
      >
        {isLoading ? 'Exploring...' : 'Auto Explore Armies'}
      </button>
    </div>
  );
}; 