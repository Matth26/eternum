import { useDojo } from "@bibliothecadao/react";
import { getComponentValue } from "@dojoengine/recs"; // Added for querying components
import { getEntityIdFromKeys } from "@dojoengine/utils"; // Import for Structure component ID
import React, { useCallback, useEffect, useState } from 'react';

// Hexagonal grid utility functions and enums (copied or adapted)
// From packages/types/src/constants/hex.ts
export enum Direction {
  EAST,
  NORTH_EAST,
  NORTH_WEST,
  WEST,
  SOUTH_WEST,
  SOUTH_EAST,
}

// From packages/types/src/constants/buildings.ts
const BUILDINGS_CENTER: [number, number] = [10, 10];

// Added from packages/types/src/constants/hex.ts
export const NEIGHBOR_OFFSETS_EVEN = [
  { i: 1, j: 0, direction: Direction.EAST },
  { i: 1, j: 1, direction: Direction.NORTH_EAST },
  { i: 0, j: 1, direction: Direction.NORTH_WEST },
  { i: -1, j: 0, direction: Direction.WEST },
  { i: 0, j: -1, direction: Direction.SOUTH_WEST },
  { i: 1, j: -1, direction: Direction.SOUTH_EAST },
];

export const NEIGHBOR_OFFSETS_ODD = [
  { i: 1, j: 0, direction: Direction.EAST },
  { i: 0, j: 1, direction: Direction.NORTH_EAST },
  { i: -1, j: 1, direction: Direction.NORTH_WEST },
  { i: -1, j: 0, direction: Direction.WEST },
  { i: -1, j: -1, direction: Direction.SOUTH_WEST },
  { i: 0, j: -1, direction: Direction.SOUTH_EAST },
];

export enum Steps {
  One = 1,
  Two = 2,
  // Three = 3, // Can be extended if needed for wider search
}

export type NeighborHex = {
  col: number;
  row: number;
  direction: Direction;
};

export const getNeighborOffsets = (row: number) => {
  return row % 2 === 0 ? NEIGHBOR_OFFSETS_EVEN : NEIGHBOR_OFFSETS_ODD;
};

const getNeighborHexes = (col: number, row: number, steps: Steps = Steps.One): NeighborHex[] => {
  // Simplified for Steps.One and Steps.Two as used by the auto-placement logic
  if (steps === Steps.One) {
    const offsets = getNeighborOffsets(row);
    return offsets.map((offset) => ({
      col: col + offset.i,
      row: row + offset.j,
      direction: offset.direction,
    }));
  } else if (steps === Steps.Two) {
    const offsets = getNeighborOffsets(row);
    return offsets.flatMap((offset) => {
      const firstStepCol = col + offset.i;
      const firstStepRow = row + offset.j;
      const secondStepOffsets = getNeighborOffsets(firstStepRow);
      // Continue in the same general direction for the second step
      const secondStepOffset = secondStepOffsets[offset.direction]; 
      return {
        col: firstStepCol + secondStepOffset.i,
        row: firstStepRow + secondStepOffset.j,
        // The direction here is the direction *to* this 2-step hex, 
        // which is the same as the first step's direction.
        direction: offset.direction, 
      };
    });
  } else {
    console.warn(`getNeighborHexes called with unsupported steps: ${steps}. Only Steps.One and Steps.Two are optimized for auto-placement.`);
    return getNeighborHexes(col, row, Steps.One); // Fallback or could extend
  }
};

const getDirectionBetweenAdjacentHexes = (
  from: { col: number; row: number },
  to: { col: number; row: number },
): Direction | null => {
  const neighbors = getNeighborHexes(from.col, from.row, Steps.One);
  return neighbors.find((n) => n.col === to.col && n.row === to.row)?.direction ?? null;
};

function getDirectionsArray(start: [number, number], end: [number, number]): Direction[] {
  const [startCol, startRow] = start;
  const [endCol, endRow] = end;

  const queue: { col: number; row: number; path: Direction[] }[] = [{ col: startCol, row: startRow, path: [] }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const { col, row, path } = current;

    if (col === endCol && row === endRow) {
      return path;
    }

    const key = `${col},${row}`;
    if (visited.has(key)) continue;
    visited.add(key);

    // Ensure getNeighborHexes is called with Steps.One for pathfinding step-by-step
    for (const { col: neighborCol, row: neighborRow } of getNeighborHexes(col, row, Steps.One)) {
      const direction = getDirectionBetweenAdjacentHexes({ col, row }, { col: neighborCol, row: neighborRow });
      if (direction !== null) {
        queue.push({ col: neighborCol, row: neighborRow, path: [...path, direction] });
      }
    }
  }
  return [];
}

// Copied from packages/types/src/constants/structures.ts
export enum BuildingType {
  None = 0,
  WorkersHut = 1,
  Storehouse = 2,
  ResourceStone = 3,
  ResourceCoal = 4,
  ResourceWood = 5,
  ResourceCopper = 6,
  ResourceIronwood = 7,
  ResourceObsidian = 8,
  ResourceGold = 9,
  ResourceSilver = 10,
  ResourceMithral = 11,
  ResourceAlchemicalSilver = 12,
  ResourceColdIron = 13,
  ResourceDeepCrystal = 14,
  ResourceRuby = 15,
  ResourceDiamonds = 16,
  ResourceHartwood = 17,
  ResourceIgnium = 18,
  ResourceTwilightQuartz = 19,
  ResourceTrueIce = 20,
  ResourceAdamantine = 21,
  ResourceSapphire = 22,
  ResourceEtherealSilica = 23,
  ResourceDragonhide = 24,
  ResourceLabor = 25,
  ResourceAncientFragment = 26,
  ResourceDonkey = 27,
  ResourceKnightT1 = 28,
  ResourceKnightT2 = 29,
  ResourceKnightT3 = 30,
  ResourceCrossbowmanT1 = 31,
  ResourceCrossbowmanT2 = 32,
  ResourceCrossbowmanT3 = 33,
  ResourcePaladinT1 = 34,
  ResourcePaladinT2 = 35,
  ResourcePaladinT3 = 36,
  ResourceWheat = 37,
  ResourceFish = 38,
}

const BUILDING_NAME_TO_TYPE_ID: Record<string, BuildingType> = {};
for (const [name, value] of Object.entries(BuildingType)) {
  if (isNaN(Number(name))) { // Enum object has both name-to-value and value-to-name entries
    BUILDING_NAME_TO_TYPE_ID[name] = value as BuildingType;
  }
}

interface BuildAction {
  structureEntityId: string; // Realm's entity_id
  buildingName: string;      // String name of the building, e.g., "ResourceStone"
  useSimpleCost: boolean;
}

type BuildInputArray = BuildAction[];

const EXAMPLE_JSON_INPUT = JSON.stringify(
  [
    {
      structureEntityId: "id",
      buildingName: "WorkersHut", // User inputs name
      useSimpleCost: false,
    },
    {
      structureEntityId: "id",
      buildingName: "ResourceStone", // User inputs name
      useSimpleCost: false,
    },
  ],
  null,
  2,
);

export const BuildBuildingsScript: React.FC = () => {
  const {
    account: { account },
    setup: { systemCalls, components },
  } = useDojo();

  const LOCAL_STORAGE_KEY = 'devtools_buildBuildingsJsonInput';

  const [jsonDataInput, setJsonDataInput] = useState<string>(() => {
    const savedJson = localStorage.getItem(LOCAL_STORAGE_KEY);
    return savedJson || EXAMPLE_JSON_INPUT;
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, jsonDataInput);
  }, [jsonDataInput]);

  const findAvailableSlot = (structureId: bigint): { col: number; row: number } | null => {
    if (!components.Building || !components.Structure) {
      console.error("BuildBuildingsScript: Building or Structure component not available in Dojo setup.");
      return null;
    }
    const structureIdStr = structureId.toString();
    console.log(`BuildBuildingsScript: findAvailableSlot called for structure ID: ${structureIdStr}`);

    const structureEntityIdForComponent = getEntityIdFromKeys([structureId]);
    const structure = getComponentValue(components.Structure, structureEntityIdForComponent);

    if (!structure || structure.base === undefined) { // Check structure.base for coords
      console.error(`BuildBuildingsScript: Structure component or structure.base not found for ID ${structureIdStr}. Cannot determine world coordinates or buildable radius.`);
      return null;
    }

    const structureWorldCol = structure.base.coord_x;
    const structureWorldRow = structure.base.coord_y;
    console.log(`BuildBuildingsScript: Structure ${structureIdStr} world coords: (${structureWorldCol}, ${structureWorldRow})`);

    const structureLevel = structure.base.level ?? 0;
    const buildableRadius = structureLevel + 1;
    console.log(`BuildBuildingsScript: Structure ${structureIdStr} - Level: ${structureLevel}, Calculated Buildable Radius (steps): ${buildableRadius}`);

    const candidateSlots: { col: number; row: number }[] = [];
    if (buildableRadius >= 1) {
      getNeighborHexes(BUILDINGS_CENTER[0], BUILDINGS_CENTER[1], Steps.One)
        .filter(hex => !(hex.col === BUILDINGS_CENTER[0] && hex.row === BUILDINGS_CENTER[1]))
        .forEach(hex => candidateSlots.push({col: hex.col, row: hex.row}));
    }
    if (buildableRadius >= 2) {
      getNeighborHexes(BUILDINGS_CENTER[0], BUILDINGS_CENTER[1], Steps.Two)
        .filter(hex => !(hex.col === BUILDINGS_CENTER[0] && hex.row === BUILDINGS_CENTER[1]))
        .forEach(hex => {
            if (!(hex.col === BUILDINGS_CENTER[0] && hex.row === BUILDINGS_CENTER[1])) {
                 if (!candidateSlots.some(s => s.col === hex.col && s.row === hex.row)) {
                    candidateSlots.push({col: hex.col, row: hex.row});
                 }
            }
        });
    }
    // TODO: Extend for buildableRadius >= 3

    console.log(`BuildBuildingsScript: Candidate slots for structure ${structureIdStr} (radius ${buildableRadius}): ${JSON.stringify(candidateSlots.map(s => `(${s.col},${s.row})`))}`);

    for (const slot of candidateSlots) {
      const { col: innerCol, row: innerRow } = slot;
      const buildingEntityId = getEntityIdFromKeys([
        BigInt(structureWorldCol),
        BigInt(structureWorldRow),
        BigInt(innerCol),
        BigInt(innerRow)
      ]);
      const building = getComponentValue(components.Building, buildingEntityId);

      if (building && building.category !== BuildingType.None) {
        console.log(`BuildBuildingsScript: Candidate slot (${innerCol},${innerRow}) on structure ${structureIdStr} is OCCUPIED by building type ${building.category}.`);
      } else {
        console.log(`BuildBuildingsScript: Found available slot for structure ${structureIdStr}: (${innerCol},${innerRow}). Direct check shows it as available or no building component.`);
        return slot; // Found an available slot
      }
    }

    console.log(`BuildBuildingsScript: No available slot found for structure ${structureIdStr} in the defined search pattern (radius ${buildableRadius}). All candidates checked directly and found occupied or no building component indicates free.`);
    return null;
  };


  const handleBuild = useCallback(async () => {
    if (!account || !account.address) {
      console.error("BuildBuildingsScript: Error - Account not available. Please connect wallet.");
      return;
    }
    if (!systemCalls?.create_building) {
      console.error("BuildBuildingsScript: Error - 'create_building' system call not found. Please check your Dojo setup.");
      return;
    }
    if (!components?.Building) {
      console.error("BuildBuildingsScript: Error - Building component not available for checking slots. Please check Dojo setup.");
      return;
    }

    let parsedInputArray: BuildInputArray;
    try {
      parsedInputArray = JSON.parse(jsonDataInput);
      if (!Array.isArray(parsedInputArray)) {
        throw new Error("Input must be a JSON array of build actions.");
      }
    } catch (error: any) {
      console.error(`BuildBuildingsScript: Error parsing JSON - ${error.message}`);
      return;
    }

    setIsLoading(true);
    console.log('BuildBuildingsScript: Initiating batch build...');
    let successfulBuilds = 0;
    let failedBuilds = 0;

    for (const [index, action] of parsedInputArray.entries()) {
      try {
        const buildingTypeNumeric = BUILDING_NAME_TO_TYPE_ID[action.buildingName];
        if (buildingTypeNumeric === undefined) {
          throw new Error(`Invalid buildingName "${action.buildingName}" in action ${index + 1}.`);
        }

        console.log(`BuildBuildingsScript: Processing action ${index + 1}/${parsedInputArray.length} - Building ${action.buildingName} on ${action.structureEntityId}...`);
        
        if (typeof action.structureEntityId !== 'string' || 
            typeof action.buildingName !== 'string' ||
            typeof action.useSimpleCost !== 'boolean') {
            throw new Error(`Invalid data types in action ${index + 1}. Check structureEntityId, buildingName, useSimpleCost.`);
        }
        
        const structureBigIntId = BigInt(action.structureEntityId);
        const availableSlot = findAvailableSlot(structureBigIntId);

        if (!availableSlot) {
          throw new Error(`No available build slots found for structure ${action.structureEntityId} within search radius.`);
        }

        const { col: selectedCol, row: selectedRow } = availableSlot;
        console.log(`BuildBuildingsScript: Found slot (${selectedCol},${selectedRow}) for ${action.buildingName} on ${action.structureEntityId}.`);

        const directions = getDirectionsArray(BUILDINGS_CENTER, [selectedCol, selectedRow]);
        if (directions.length === 0 && (selectedCol !== BUILDINGS_CENTER[0] || selectedRow !== BUILDINGS_CENTER[1])) {
            throw new Error(`Could not find a path to automatically selected coordinates (${selectedCol}, ${selectedRow}) for action ${index + 1}. This should not happen if slot is valid.`);
        }

        await systemCalls.create_building({
          signer: account,
          entity_id: structureBigIntId,
          directions: directions,
          building_category: buildingTypeNumeric,
          use_simple: action.useSimpleCost,
        });
        successfulBuilds++;
        console.log(`BuildBuildingsScript: Action ${index + 1} successful - Built ${action.buildingName} on ${action.structureEntityId} at (${selectedCol},${selectedRow}).`);
      } catch (error: any) {
        failedBuilds++;
        console.error(`BuildBuildingsScript: Error in build action ${index + 1} for structure ${action.structureEntityId} (Building: ${action.buildingName}) - ${error.message}`);
      }
    }

    setIsLoading(false);
    console.log(`BuildBuildingsScript: Build finished. Successful: ${successfulBuilds}, Failed: ${failedBuilds}. ${failedBuilds > 0 ? 'Check console for error details on failed actions.' : ''}`);

  }, [jsonDataInput, account, systemCalls, components, findAvailableSlot]);

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
        placeholder="Enter JSON array of build actions here..."
        disabled={isLoading}
      />
      <button
        style={buttonStyle}
        onClick={handleBuild}
        disabled={isLoading || !account?.address || !systemCalls?.create_building || !components?.Building}
      >
        {isLoading ? 'Building...' : 'Execute Build Actions'}
      </button>
    </div>
  );
}; 