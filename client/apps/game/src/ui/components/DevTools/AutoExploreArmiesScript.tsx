import { useDojo, useExplorersByStructure, usePlayerStructures } from '@bibliothecadao/react';
import { getTilesFromToriiClient } from "@bibliothecadao/torii-client";
import { getDirectionBetweenAdjacentHexes, getNeighborHexes, ID, StructureType } from '@bibliothecadao/types';
import { getComponentValue, Has, runQuery } from '@dojoengine/recs';
import React, { useCallback, useState } from 'react';

const ARMY_MIN_SIZE = 2000;
const ARMY_REINFORCE_AMOUNT = 1900;
const MAP_CENTER = { x: 0, y: 0 };

// Add these style variables near the top, after imports
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '2px', fontSize: '0.9em' };
const selectStyle: React.CSSProperties = { marginLeft: 8, background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: '4px 8px' };
const optionStyle: React.CSSProperties = { background: '#222', color: '#fff' };

interface AutoExploreArmiesScriptProps {
  log: (message: string, type?: 'info' | 'error' | 'success', script?: string) => void;
}

export const AutoExploreArmiesScript: React.FC<AutoExploreArmiesScriptProps> = ({ log }) => {
  const {
    account: { account },
    setup: { components, systemCalls, network: { toriiClient } },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);
  const [exploreDirection, setExploreDirection] = useState<'center' | 'north' | 'south' | 'east' | 'west'>('center');

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
      // 2. Use allPlayerArmies for further logic
      if (allPlayerArmies.length === 0) {
        log('No player armies found.', 'error', 'AutoExploreArmies');
        setIsLoading(false);
        return;
      }
      // --- NEW: Gather all unique neighbor positions ---
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
      // 4. For each army, find empty adjacent tile closest to center and explore
      const exploredTargets = new Set<string>();
      for (const army of allPlayerArmies) {
        let neighbors = getNeighborHexes(army.position.x, army.position.y);
        if (exploreDirection !== 'center') {
          neighbors = neighbors.filter((neighbor: any) => {
            if (exploreDirection === 'north') return neighbor.row > army.position.y;
            if (exploreDirection === 'south') return neighbor.row < army.position.y;
            if (exploreDirection === 'east') return neighbor.col > army.position.x;
            if (exploreDirection === 'west') return neighbor.col < army.position.x;
            return true;
          });
        }
        let bestTile = null;
        let bestDist = Infinity;
        // First pass: unexplored
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
          if (!occupied) {
            const tile = tileMap.get(`${neighbor.col},${neighbor.row}`);
            if (tile && tile.biome !== 0) {
              occupied = true;
              // skip for first pass
            }
          }
          if (!occupied) {
            const targetKey = `${neighbor.col},${neighbor.row}`;
            if (exploredTargets.has(targetKey)) {
              occupied = true;
            }
          }
          if (!occupied) {
            const dist = Math.abs(neighbor.col - MAP_CENTER.x) + Math.abs(neighbor.row - MAP_CENTER.y);
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
                const dist = Math.abs(neighbor.col - MAP_CENTER.x) + Math.abs(neighbor.row - MAP_CENTER.y);
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
  }, [account, components, systemCalls, toriiClient, log, allPlayerArmies, playerStructures, exploreDirection]);

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
      <div style={{ marginBottom: '10px' }}>
        <label style={labelStyle}>Explore direction:
          <select value={exploreDirection} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setExploreDirection(e.target.value as any)} style={selectStyle}>
            <option value="center" style={optionStyle}>Center (all)</option>
            <option value="north" style={optionStyle}>North</option>
            <option value="south" style={optionStyle}>South</option>
            <option value="east" style={optionStyle}>East</option>
            <option value="west" style={optionStyle}>West</option>
          </select>
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