import { Position } from "@/types/position";
import { queryRealmCount } from "@/ui/components/cityview/realm/settle-realm-component";
import { generateSettlementLocations } from "@/ui/components/settlement/settlement-utils";
import { getMaxLayer } from "@/utils/settlement";
import { useDojo } from "@bibliothecadao/react";
import React, { useState } from 'react';

export const GetAllLocationsScript: React.FC = () => {
  const {
    account: { account }, // account might be needed by queryRealmCount or other utils implicitly
    setup: { components }, // components might be needed by queryRealmCount or other utils implicitly
  } = useDojo();

  const [jsonDataOutput, setJsonDataOutput] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string>('');

  const handleGetAllLocations = async () => {
    if (!account) { // Basic check, even if not directly used by generateSettlementLocations
      setFeedback('Error: Account not available. Please connect wallet.');
      return;
    }

    setIsLoading(true);
    setFeedback('Generating all locations...');
    setJsonDataOutput('');

    try {
      // Step 1: Determine maxLayers
      const realmCountResult = await queryRealmCount(); 
      
      if (realmCountResult === null) {
        throw new Error('Could not determine realm count.');
      }
      const realmCount = realmCountResult; // Now definitely a number

      const maxLayersValue = getMaxLayer(realmCount);
      
      if (maxLayersValue === null || maxLayersValue === undefined) {
        throw new Error('Could not determine maximum layers for settlement.');
      }
      const maxLayers = maxLayersValue; // Now definitely a number

      setFeedback(`Current realm count: ${realmCount}, Max settlement layers: ${maxLayers}. Generating locations...`);

      // Step 2: Generate all potential locations
      const [allLocationsArray, _allLocationsMap] = generateSettlementLocations(maxLayers);
      
      // Step 3: Sort and transform locations
      const processedLocations = allLocationsArray
        .sort((a, b) => {
          if (a.side !== b.side) {
            return a.side - b.side;
          }
          if (a.layer !== b.layer) {
            return a.layer - b.layer;
          }
          return a.point - b.point;
        })
        .map(location => {
          const contractX = location.x;
          const contractY = location.y;
          const normalizedPosition = new Position({ x: contractX, y: contractY }).getNormalized();
          return {
            side: location.side,
            layer: location.layer,
            point: location.point,
            x: normalizedPosition.x, // Human-readable X
            y: normalizedPosition.y, // Human-readable Y
            contractX: contractX,     // Original contract X
            contractY: contractY,     // Original contract Y
          };
        });
      
      const outputObject = {
        realmCount,
        maxLayers,
        totalLocationsGenerated: processedLocations.length,
        locations: processedLocations, // Use the processed locations
      };

      setJsonDataOutput(JSON.stringify(outputObject, null, 2));
      setFeedback(`Successfully generated ${processedLocations.length} total possible locations up to layer ${maxLayers}.`);
      
    } catch (error) {
      console.error("Error generating all locations:", error);
      setFeedback(`Error generating locations: ${(error as Error).message}`);
      setJsonDataOutput('');
    } finally {
      setIsLoading(false);
    }
  };

  const textAreaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '200px',
    marginTop: '10px',
    padding: '8px',
    border: '1px solid #777',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    fontFamily: 'monospace',
    fontSize: '0.9em',
    boxSizing: 'border-box',
  };

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

  const feedbackStyle: React.CSSProperties = {
    marginTop: '10px',
    padding: '8px',
    backgroundColor: feedback.startsWith('Error:') ? '#d9534f' : '#5bc0de',
    color: 'white',
    borderRadius: '4px',
    fontSize: '0.9em',
    whiteSpace: 'pre-wrap', // To preserve formatting of multi-line feedback
  };

  return (
    <div>
      <h4>Get All Possible Settlement Locations</h4>
      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
        This script calculates all possible settlement locations based on the current realm count and max layers.
        It does not check for availability (i.e., if a location is already occupied).
      </p>
      <button 
        style={buttonStyle}
        onClick={handleGetAllLocations} 
        disabled={isLoading}
      >
        {isLoading ? 'Generating...' : 'Get All Locations (JSON)'}
      </button>
      {feedback && (
        <div style={feedbackStyle}>
          {feedback}
        </div>
      )}
      {jsonDataOutput && (
        <textarea
          style={textAreaStyle}
          value={jsonDataOutput}
          readOnly
          placeholder='JSON output of all locations will appear here...'
        />
      )}
    </div>
  );
}; 