import { Position } from "@/types/position";
import { queryRealmCount } from "@/ui/components/cityview/realm/settle-realm-component";
import {
  generateSettlementLocations,
  getBanksLocations,
} from "@/ui/components/settlement/settlement-utils";
import { getMaxLayer } from "@/utils/settlement";
import { useDojo } from "@bibliothecadao/react";
import React, { useCallback, useState } from 'react';

interface ExportLocation {
  normalizedX: number;
  normalizedY: number;
  originalContractX: number;
  originalContractY: number;
  side: number;
  layer: number;
  point: number;
}

interface ExportData {
  maxLayers: number;
  center: { x: number; y: number };
  banks: ExportLocation[];
  allPotentialSpots: ExportLocation[];
}

export const GetBaseMapTilesScript: React.FC = () => {
  const {
    setup: { components },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);

  const normalizeCoords = (contractX: number, contractY: number): { x: number; y: number } => {
    const pos = new Position({ x: contractX, y: contractY });
    return pos.getNormalized();
  };

  const handleExportLocations = useCallback(async () => {
    setIsLoading(true);

    try {
      // 1. Get Max Layers
      const realmCountResult = await queryRealmCount();
      if (realmCountResult === null) {
        throw new Error('Could not determine realm count.');
      }
      const maxLayers = getMaxLayer(realmCountResult);
      if (maxLayers === null) {
        throw new Error('Could not determine maximum layers for settlement.');
      }

      // 2. Generate All Potential Settlement Locations
      const [rawLocationsArray, _locationsMap] = generateSettlementLocations(maxLayers);
      const allPotentialSpots: ExportLocation[] = rawLocationsArray.map(loc => {
        const normalized = normalizeCoords(loc.x, loc.y);
        return {
          normalizedX: normalized.x,
          normalizedY: normalized.y,
          originalContractX: loc.x,
          originalContractY: loc.y,
          side: loc.side,
          layer: loc.layer,
          point: loc.point,
        };
      });

      // 3. Get Bank Locations
      const banksRaw = getBanksLocations(components);
       if (!banksRaw || !Array.isArray(banksRaw)) {
         console.error("handleExportLocations: banksRaw is not a valid array! Value:", banksRaw);
         throw new Error("getBanksLocations did not return a valid array.");
       }
      const banks: ExportLocation[] = banksRaw.map(b => {
        if (!b || typeof b.x === 'undefined' || typeof b.y === 'undefined') {
          throw new Error(`Invalid bank object encountered from getBanksLocations.`);
        }
        const normalized = normalizeCoords(b.x, b.y);
        return {
          normalizedX: normalized.x,
          normalizedY: normalized.y,
          originalContractX: b.x,
          originalContractY: b.y,
          side: b.side,
          layer: b.layer,
          point: b.point,
        };
      });

      // 4. Prepare Export Object
      const outputData: ExportData = {
        maxLayers: maxLayers,
        center: normalizeCoords(0, 0), // Center is always 0,0 in contract coords
        banks: banks,
        allPotentialSpots: allPotentialSpots,
      };

      // 5. Trigger Download
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(outputData, null, 2)
      )}`;
      const link = document.createElement("a");
      link.href = jsonString;
      link.download = "eternum_all_locations.json";
      link.click();

    } catch (error) {
      console.error("Error exporting locations:", error);
    } finally {
      setIsLoading(false);
    }
  }, [components]); // generateSettlementLocations, getBanksLocations, getMaxLayer, queryRealmCount are stable

  // Basic Styles
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

  return (
    <div>
      <h4>Export hex map</h4>
      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
        Export the tiles for the whole map.
      </p>
      <button
        style={buttonStyle}
        onClick={handleExportLocations}
        disabled={isLoading}
      >
        {isLoading ? 'Generating...' : 'Export All Locations (JSON)'}
      </button>
    </div>
  );
};