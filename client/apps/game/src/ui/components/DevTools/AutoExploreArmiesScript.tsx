import { useDojo, useExplorersByStructure, usePlayerStructures } from '@bibliothecadao/react';
import { getTilesFromToriiClient } from "@bibliothecadao/torii-client";
import { getDirectionBetweenAdjacentHexes, getNeighborHexes, ID, StructureType } from '@bibliothecadao/types';
import { getComponentValue, Has, runQuery } from '@dojoengine/recs';
import React, { useCallback, useEffect, useState } from 'react';
import { normalizedToContractCoords } from '../settlement/settlement-utils';

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
  const [inputX, setInputX] = useState<string>("");
  const [inputY, setInputY] = useState<string>("");

  // Persist X and Y to localStorage
  useEffect(() => {
    const savedX = localStorage.getItem("autoExploreInputX");
    const savedY = localStorage.getItem("autoExploreInputY");
    if (savedX !== null) setInputX(savedX);
    if (savedY !== null) setInputY(savedY);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      localStorage.setItem("autoExploreInputX", inputX);
      localStorage.setItem("autoExploreInputY", inputY);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [inputX, inputY]);

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
      for (const army of allPlayerArmies) {
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