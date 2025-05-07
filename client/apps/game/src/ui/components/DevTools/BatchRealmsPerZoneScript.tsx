import { env } from "@/../env"; // For Torii URL and fee recipient
import { Position as PositionFromTypes } from "@/types/position"; // Ensure this is the correct Position class
import { queryRealmCount } from "@/ui/components/cityview/realm/settle-realm-component";
import {
  generateSettlementLocations,
  getBanksLocations,
  getOccupiedLocations,
} from "@/ui/components/settlement/settlement-utils";
import { getSeasonPassAddress } from "@/utils/addresses"; // For season pass contract address
import { getMaxLayer } from "@/utils/settlement";
import { calculateDistance, getOffchainRealm } from "@bibliothecadao/eternum";
import { useDojo } from "@bibliothecadao/react";
import { ContractAddress, getNeighborHexes } from "@bibliothecadao/types"; // For neighbor calculation
import { gql } from "graphql-request"; // For season pass fetching
import React, { useCallback, useEffect, useState } from 'react';
import { addAddressPadding } from "starknet"; // For season pass fetching

// Interfaces (some might be defined elsewhere and imported)
interface SettlementLocation {
  side: number;
  layer: number;
  point: number;
  x: number; // Human-readable X (normalized)
  y: number; // Human-readable Y (normalized)
  contractX: number;
  contractY: number;
  // minDistanceToBank?: number; // From GetAllLocationsScript, may not be needed directly here
}

interface SeasonPassInfo { // From GetMySeasonPassesScript
  realmId: number;
  name: string;
  tokenId: string; // This is usually a string, getOffchainRealm takes number
}

interface RealmSettlementInput { // For the final JSON structure
  realm_id: number;
  realm_settlement: {
    side: number;
    layer: number;
    point: number;
  };
}

// Helper to query season passes (adapted from GetMySeasonPassesScript)
const queryAllPlayerTokens = async (accountAddress: string) => {
  const getAccountTokensQuery = gql`
    query getAccountTokens($accountAddress: String!) {
      tokenBalances(accountAddress: $accountAddress, limit: 8000) {
        edges {
          node {
            tokenMetadata {
              __typename
              ... on ERC721__Token {
                tokenId
                contractAddress
              }
            }
          }
        }
      }
    }
  `;
  try {
    const fetchUrl = env.VITE_PUBLIC_TORII + "/graphql";
    const response = await fetch(fetchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/graphql-response+json",
      },
      body: JSON.stringify({
        query: getAccountTokensQuery,
        variables: { accountAddress },
      }),
    });
    const json = await response.json();

    if (json.errors) {
      throw new Error("Error fetching tokens from GraphQL: " + json.errors.map((e: any) => e.message).join(", "));
    }
    if ("data" in json && json.data) {
      return json.data.tokenBalances?.edges || [];
    }
    throw new Error("No data returned from GraphQL or unexpected structure.");
  } catch (error) {
    console.error("Error querying player tokens:", error);
    throw error;
  }
};


export const BatchRealmsPerZoneScript: React.FC = () => {
  const {
    account: { account },
    setup: { 
      components, // Needed for getBanksLocations, and potentially other utils
      systemCalls: { create_multiple_realms },
    },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string>('');
  const [jsonDataOutput, setJsonDataOutput] = useState<string>('');
  
  const [allZoneLocations, setAllZoneLocations] = useState<SettlementLocation[][]>([]);
  const [playerSeasonPasses, setPlayerSeasonPasses] = useState<SeasonPassInfo[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<number>(1); // Default to Zone 1
  
  const [maxLayers, setMaxLayersState] = useState<number | null>(null);
  const [allLocationsMap, setAllLocationsMap] = useState<Map<string, SettlementLocation> | null>(null);


  // TODO: Implement fetchAllData function (Step 2 & 3 from plan)
  const fetchAllData = useCallback(async () => {
    if (!account || !components || !account.address) {
      setFeedback("Error: Account address or components not available. Please connect wallet and ensure setup is complete.");
      return;
    }

    setIsLoading(true);
    setFeedback("Fetching all necessary data...");

    try {
      // 1. Get Max Layers (from GetAllLocationsScript logic)
      const realmCountResult = await queryRealmCount();

      if (realmCountResult === null) {
        console.error("fetchAllData: realmCountResult is null"); // New log
        throw new Error("Could not determine realm count.");
      }
      const currentMaxLayers = getMaxLayer(realmCountResult);

      if (currentMaxLayers === null || currentMaxLayers === undefined) {
        console.error("fetchAllData: currentMaxLayers is null or undefined"); // New log
        throw new Error("Could not determine maximum layers for settlement.");
      }
      setMaxLayersState(currentMaxLayers);

      // 2. Generate All Potential Settlement Locations
      const [rawLocationsArray, generatedLocationsMap] = generateSettlementLocations(currentMaxLayers);
      if (rawLocationsArray) {
      } else {
        console.error("fetchAllData: rawLocationsArray is null or undefined!");
      }

      const allGeneratedLocationsArray = rawLocationsArray.map(loc => ({
        side: loc.side,
        layer: loc.layer,
        point: loc.point,
        contractX: loc.x, // map contract coord x
        contractY: loc.y, // map contract coord y
        // Normalized x and y are not explicitly calculated here unless needed later.
        // The script primarily uses contractX/Y for distances and neighbor checks.
        x: new PositionFromTypes({ x: loc.x, y: loc.y }).getNormalized().x, // Populate normalized x
        y: new PositionFromTypes({ x: loc.x, y: loc.y }).getNormalized().y, // Populate normalized y
      })) as SettlementLocation[];

      const mapForNeighborCheck = new Map<string, SettlementLocation>();
      allGeneratedLocationsArray.forEach((loc, index) => {
          if (index % 500 === 0) { // Log every 500 iterations
          }
          mapForNeighborCheck.set(`${loc.contractX},${loc.contractY}`, loc as SettlementLocation)
      });
      
      setAllLocationsMap(mapForNeighborCheck);

      // ----> Filter out occupied locations <----
      console.log("fetchAllData: Fetching occupied locations...");
      const occupiedLocations = await getOccupiedLocations(ContractAddress(account.address), components, generatedLocationsMap);
      const occupiedCoords = new Set(occupiedLocations.map(loc => `${loc.x},${loc.y}`)); 
      console.log(`fetchAllData: Found ${occupiedCoords.size} occupied locations.`);

      const availableGeneratedLocationsArray = allGeneratedLocationsArray.filter(loc => 
        !occupiedCoords.has(`${loc.contractX},${loc.contractY}`)
      );
      console.log(`fetchAllData: Filtered available locations. Count: ${availableGeneratedLocationsArray.length} (down from ${allGeneratedLocationsArray.length})`);
      // ----> END NEW SECTION <----

      // 3. Get Bank Locations
      const allBanksRaw = getBanksLocations(components);
      
      if (!allBanksRaw || !Array.isArray(allBanksRaw)) {
        console.error("fetchAllData: allBanksRaw is not a valid array! Value:", allBanksRaw);
        throw new Error("getBanksLocations did not return a valid array.");
      }

      const allBanks = allBanksRaw.map((b, index) => {
        if (!b || typeof b.x === 'undefined' || typeof b.y === 'undefined') {
          console.error(`fetchAllData: Invalid bank object at index ${index}:`, b);
          // Decide how to handle: throw error, or return a placeholder, or filter out
          // For now, let's throw to make it clear there's a data issue.
          throw new Error(`Invalid bank object encountered at index ${index} from getBanksLocations.`);
        }
        return {
          ...b, 
          contractX: b.x, 
          contractY: b.y  
        };
      }) as SettlementLocation[];

      if (!allBanks || allBanks.length === 0) {
        console.error("fetchAllData: allBanks is null, undefined, or empty after mapping!"); 
        throw new Error("No bank locations found (or all were invalid)."); 
      }

      if (allBanks.length < 4) {
        console.warn(`fetchAllData: Only ${allBanks.length} banks found. Some bank zones may be duplicates or empty.`); 
        setFeedback(`Warning: Only ${allBanks.length} banks found. Need at least 4 for all bank zones. Some bank zones may be duplicates or empty.`);
      }
      
      // Fallthrough to allow script to run with fewer bank zones if possible, or let user decide.
      // setFeedback("Processing zone locations..."); // This was an old feedback line, the one below is more accurate for timing
      
      setFeedback("Processing zone locations based on AVAILABLE spots...");

      // Define center for distance calculations
      const gameCenter = { x: 0, y: 0 }; 

      // Prepare candidate lists for each zone type
      let zone1to6Candidates: SettlementLocation[][] = [];
      for (let side = 0; side < 6; side++) {
        
        const locationsForThisSide = availableGeneratedLocationsArray.filter(loc => loc.side === side);

        const locationsWithDist = locationsForThisSide.map((loc, index) => {
          const dist = calculateDistance({x: loc.contractX, y: loc.contractY}, gameCenter);
          if (side === 5 && index < 5) { // Log first 5 for side 5
          }
          return { loc, dist };
        });

        // Log before sort for side 5
        if (side === 5 && locationsWithDist.length > 0) {
            console.log(`fetchAllData: Side 5 - BEFORE sort (first 5 distances):`, locationsWithDist.slice(0,5).map(item => item.dist));
        }

        const sortedLocations = locationsWithDist.sort((a, b) => {
            if (isNaN(a.dist) || isNaN(b.dist)) {
                console.error(`fetchAllData: NaN distance encountered in sort! a.dist: ${a.dist}, b.dist: ${b.dist}`, {a,b});
                // Handle NaN: perhaps place them at the end or throw an error
                if (isNaN(a.dist) && isNaN(b.dist)) return 0;
                return isNaN(a.dist) ? 1 : -1; // NaNs go to the end
            }
            return a.dist - b.dist;
        });

        // Log after sort for side 5
        if (side === 5 && sortedLocations.length > 0) {
            console.log(`fetchAllData: Side 5 - AFTER sort (first 5 distances):`, sortedLocations.slice(0,5).map(item => item.dist));
        }

        const sideLocations = sortedLocations.map(item => item.loc as SettlementLocation);
        
        zone1to6Candidates.push(sideLocations);
      }
      console.log("fetchAllData: Finished zone1to6Candidates loop. Total sides processed:", zone1to6Candidates.length);

      // Select 4 distinct banks for zones 7-10
      console.log("fetchAllData: Starting bank selection for zones 7-10..."); 

      // Changed to individual declarations as a workaround for potential transpiler/engine bug
      let bankW: SettlementLocation | undefined;
      let bankE: SettlementLocation | undefined;
      let bankSW: SettlementLocation | undefined;
      let bankSE: SettlementLocation | undefined;

      // Restore original bank selection logic
      if (allBanks.length > 0) { 
        const sortedBanksByX = [...allBanks].sort((a, b) => a.contractX - b.contractX);
        bankW = sortedBanksByX[0];
        bankE = sortedBanksByX[sortedBanksByX.length - 1];

        const midXBanks = allBanks.filter(b => b !== bankW && b !== bankE);
        if (midXBanks.length >= 2) {
            const sortedMidByY = midXBanks.sort((a,b) => a.contractY - b.contractY);
            bankSW = sortedMidByY[0]; 
            bankSE = sortedMidByY[sortedMidByY.length - 1]; 
        } else if (midXBanks.length === 1) {
            bankSW = midXBanks[0];
            bankSE = midXBanks[0]; 
        } else { 
            bankSW = bankW; 
            bankSE = bankE; 
        }

         // This specific block for allBanks.length 1,2,3 is mostly for ensuring all banks are defined if initial count is very low.
         // Given allBanks.length is 6 in the test case, this block might not be strictly hit for assignment beyond initial W/E/SW/SE logic.
        if (allBanks.length === 1) { 
            bankE = bankW; bankSW = bankW; bankSE = bankW;
        }
        else if (allBanks.length === 2) { 
            bankSW = bankW; bankSE = bankE; 
        }
        else if (allBanks.length === 3) { 
            const thirdBank = allBanks.find(b => b !== bankW && b !== bankE);
            bankSW = thirdBank || bankW; 
            bankSE = bankE;
        }
        console.log("fetchAllData: Final bank assignments:", {bankW, bankE, bankSW, bankSE}); // New log
      } else {
        console.log("fetchAllData: Skipping bank selection as allBanks is empty or not > 0.");
      }
      
      const targetBanks: (SettlementLocation | undefined)[] = [bankW, bankSW, bankSE, bankE];

      let zone7to10Candidates: SettlementLocation[][] = [];
      // Add index to track which bank we are processing
      for (const [index, targetBank] of targetBanks.entries()) {
        const bankIdentifier = targetBank ? `Bank ${index} (x:${targetBank.contractX}, y:${targetBank.contractY})` : `Bank ${index} (undefined)`;
        console.log(`fetchAllData: Processing ${bankIdentifier} for zone7to10.`);

        if (!targetBank) { 
            console.log(`fetchAllData: Skipping undefined bank at index ${index}.`);
            zone7to10Candidates.push([]); 
            continue;
        }

        const distBankToCenter = calculateDistance({x: targetBank.contractX, y: targetBank.contractY}, gameCenter);

        const filteredLocations = availableGeneratedLocationsArray
          .filter(loc => {
            const distLocToCenter = calculateDistance({x: loc.contractX, y: loc.contractY}, gameCenter);
            // Add check for NaN distLocToCenter just in case
            if (isNaN(distLocToCenter)) {
                console.warn(`fetchAllData: NaN distLocToCenter for loc ${loc.contractX},${loc.contractY}`);
                return false; // Exclude locations with NaN distance to center
            }
            return distLocToCenter <= distBankToCenter;
          });
        
        const locationsWithDist = filteredLocations.map(loc => ({
          loc, 
          dist: calculateDistance({x: loc.contractX, y: loc.contractY}, {x: targetBank.contractX, y: targetBank.contractY})
        }));        

        const sortedLocations = locationsWithDist.sort((a, b) => {
            if (isNaN(a.dist) || isNaN(b.dist)) {
                console.error(`fetchAllData: NaN distance encountered in sort for ${bankIdentifier}! a.dist: ${a.dist}, b.dist: ${b.dist}`, {a_loc: a.loc, b_loc: b.loc});
                if (isNaN(a.dist) && isNaN(b.dist)) return 0;
                return isNaN(a.dist) ? 1 : -1; 
            }
            return a.dist - b.dist;
        });

        const bankZoneLocations = sortedLocations.map(item => item.loc as SettlementLocation);
        zone7to10Candidates.push(bankZoneLocations);
      }
      const allZoneCandidateLists = [...zone1to6Candidates, ...zone7to10Candidates]; 

      const finalProcessedZones: SettlementLocation[][] = Array(10).fill(null).map(() => []);
      const allocatedContractCoords = new Set<string>();

      for (let i = 0; i < 10; i++) { // For each zone (0-9 for zones 1-10)
        const currentZoneCandidates = allZoneCandidateLists[i] || []; 

        let addedCount = 0;
        for (const candidateLoc of currentZoneCandidates) {
          if (finalProcessedZones[i].length >= 50) {
            break; 
          }

          const coordString = `${candidateLoc.contractX},${candidateLoc.contractY}`;
          if (!allocatedContractCoords.has(coordString)) {
            finalProcessedZones[i].push(candidateLoc);
            allocatedContractCoords.add(coordString);
            addedCount++;
          }
        }
      }
      setAllZoneLocations(finalProcessedZones);

      // 4. Fetch Player's Season Passes (from GetMySeasonPassesScript logic)
      const tokens = await queryAllPlayerTokens(account.address);

      const seasonPassContractAddress = await getSeasonPassAddress();

      const passes: SeasonPassInfo[] = [];
      if (tokens && Array.isArray(tokens)) {
        for (const edge of tokens) {
          const tokenMetadata = edge?.node?.tokenMetadata;
          if (
            tokenMetadata &&
            tokenMetadata.__typename === "ERC721__Token" &&
            tokenMetadata.contractAddress &&
            tokenMetadata.tokenId &&
            addAddressPadding(tokenMetadata.contractAddress) === addAddressPadding(seasonPassContractAddress)
          ) {
            // Using Number() based on GetMySeasonPassesScript logic for getOffchainRealm
            const realmData = getOffchainRealm(Number(tokenMetadata.tokenId));
            if (realmData) {
              passes.push({
                realmId: realmData.realmId,
                name: realmData.name,
                tokenId: tokenMetadata.tokenId,
              });
            }
          }
        }
      } else {
         console.warn("fetchAllData: 'tokens' is not a valid array, cannot process season passes.");
      }
      passes.sort((a, b) => a.realmId - b.realmId);
      setPlayerSeasonPasses(passes);

      setFeedback(`Data fetch complete. Max Layers: ${maxLayers}. Found ${passes.length} season passes.`);

    } catch (error) {
      console.error("Error in fetchAllData:", error);
      setFeedback(`Error: ${(error as Error).message}`);
      setAllZoneLocations([]);
      setPlayerSeasonPasses([]);
    } finally {
      setIsLoading(false);
    }
  }, [account, components]); // queryRealmCount, getMaxLayer, generateSettlementLocations, getBanksLocations, getSeasonPassAddress are stable utils

  // TODO: Implement countPotentialNeighbors function (Step 4 from plan)
  const countPotentialNeighbors = useCallback((
    location: SettlementLocation,
    mapToCheck: Map<string, SettlementLocation> | null,
    // currentMaxLayers: number | null // May not be needed if mapToCheck is comprehensive
  ): number => {
    if (!mapToCheck || !location || typeof location.contractX === 'undefined' || typeof location.contractY === 'undefined') return 0;
    
    const neighbors = getNeighborHexes(location.contractX, location.contractY);
    let count = 0;
    for (const neighbor of neighbors) {
        if (mapToCheck.has(`${neighbor.col},${neighbor.row}`)) {
            count++;
        }
    }
    return count;
  }, []);


  // TODO: Implement generateSettlementDataForZone function (Step 4 from plan)
  const generateSettlementDataForZone = useCallback(() => {
    if (isLoading || allZoneLocations.length === 0 || playerSeasonPasses.length === 0 || !allLocationsMap || maxLayers === null) {
      setJsonDataOutput('');
      if (!isLoading) setFeedback('Waiting for data or pass/zone selection...');
      return;
    }

    const zoneIndex = selectedZoneId - 1;
    if (zoneIndex < 0 || zoneIndex >= allZoneLocations.length) {
      setFeedback(`Error: Selected zone ${selectedZoneId} is invalid.`);
      setJsonDataOutput('');
      return;
    }

    const locationsForThisZone = allZoneLocations[zoneIndex];
    if (!locationsForThisZone || locationsForThisZone.length === 0) {
        setFeedback(`No locations available for Zone ${selectedZoneId}. Run data fetch or check zone processing logic.`);
        setJsonDataOutput('');
        return;
    }
    
    setFeedback(`Generating settlement plan for Zone ${selectedZoneId} with ${playerSeasonPasses.length} passes and ${locationsForThisZone.length} locations...`);

    const settlementPlan: RealmSettlementInput[] = [];
    let availableSpotsInZone = [...locationsForThisZone];

    const wonderPasses = playerSeasonPasses.filter((p: SeasonPassInfo) => {
        const realm = getOffchainRealm(Number(p.tokenId)); // getOffchainRealm needs number
        return realm?.wonder;
    });
    const normalPasses = playerSeasonPasses.filter((p: SeasonPassInfo) => {
        const realm = getOffchainRealm(Number(p.tokenId));
        return !realm?.wonder;
    });
    
    // Place wonders first
    wonderPasses.forEach((pass: SeasonPassInfo) => {
        let placed = false;
        for (let i = 0; i < availableSpotsInZone.length; i++) {
            const spot = availableSpotsInZone[i];
            if (countPotentialNeighbors(spot, allLocationsMap) === 6) {
                const realmData = getOffchainRealm(Number(pass.tokenId));
                if (realmData) {
                    settlementPlan.push({
                        realm_id: realmData.realmId,
                        realm_settlement: { side: spot.side, layer: spot.layer, point: spot.point }
                    });
                    availableSpotsInZone.splice(i, 1); // Remove spot
                    placed = true;
                    break;
                }
            }
        }
        // Fallback: if no wonder spot found, or if it's not actually a wonder (should be filtered by wonderPasses), place normally
        if (!placed) {
            const spot = availableSpotsInZone.shift();
            if (spot) {
                const realmData = getOffchainRealm(Number(pass.tokenId));
                 if (realmData) {
                    settlementPlan.push({
                        realm_id: realmData.realmId,
                        realm_settlement: { side: spot.side, layer: spot.layer, point: spot.point }
                    });
                }
            } else {
                 setFeedback(`Warning: Not enough spots in Zone ${selectedZoneId} for wonder realm ${pass.realmId}`);
            }
        }
    });

    // Place normal passes
    normalPasses.forEach((pass: SeasonPassInfo) => {
        const spot = availableSpotsInZone.shift();
        if (spot) {
            const realmData = getOffchainRealm(Number(pass.tokenId));
            if (realmData) {
                settlementPlan.push({
                    realm_id: realmData.realmId,
                    realm_settlement: { side: spot.side, layer: spot.layer, point: spot.point }
                });
            }
        } else {
            setFeedback(`Warning: Not enough spots in Zone ${selectedZoneId} for normal realm ${pass.realmId}`);
        }
    });


    setJsonDataOutput(JSON.stringify(settlementPlan, null, 2));
    if(settlementPlan.length > 0) {
        setFeedback(`Settlement JSON generated for Zone ${selectedZoneId} with ${settlementPlan.length} realms. Review and click Settle.`);
    } else if (playerSeasonPasses.length > 0) {
        setFeedback(`Could not generate settlement for Zone ${selectedZoneId}. No spots available or passes could not be mapped.`);
    }

  }, [selectedZoneId, playerSeasonPasses, allZoneLocations, isLoading, allLocationsMap, maxLayers, countPotentialNeighbors]);

  useEffect(() => {
    generateSettlementDataForZone();
  }, [generateSettlementDataForZone]);


  // TODO: Implement handleSettleRealms function (Step 6 from plan)
  const handleSettleRealms = async () => {
     if (!account || !create_multiple_realms) {
      setFeedback('Error: Account or system call not available.');
      return;
    }
    if (!jsonDataOutput) {
        setFeedback('Error: No settlement JSON data to process.');
        return;
    }

    let parsedData: RealmSettlementInput[];
    try {
      parsedData = JSON.parse(jsonDataOutput);
      // Basic validation (can be more thorough)
      if (!Array.isArray(parsedData) || parsedData.length === 0) {
        throw new Error('Invalid or empty JSON data.');
      }
      // Further validation for each item structure could be added here
    } catch (error) {
      setFeedback(`Error parsing JSON: ${(error as Error).message}`);
      return;
    }

    setIsLoading(true);
    setFeedback(`Settling ${parsedData.length} realms for Zone ${selectedZoneId}...`);

    try {
      if (!env || !env.VITE_PUBLIC_CLIENT_FEE_RECIPIENT) {
        throw new Error('Client fee recipient address is not configured in env.');
      }
      const seasonPassAddress = await getSeasonPassAddress(); // Get dynamically

      await create_multiple_realms({
        realms: parsedData, // This is RealmBatchSettleTransferObjects[], need to match the type.
                            // RealmSettlementInput seems compatible with RealmBatchSettleObject.
        owner: account.address,
        frontend: env.VITE_PUBLIC_CLIENT_FEE_RECIPIENT,
        signer: account, // This should be account itself, not just account.address
        season_pass_address: seasonPassAddress, 
      });
      setFeedback(`Successfully initiated settlement for ${parsedData.length} realm(s) in Zone ${selectedZoneId}.`);
    } catch (error) {
      console.error("Error settling realms:", error);
      setFeedback(`Error settling realms: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Styles (can be reused or defined in a common place)
  const commonStyles = {
    textArea: { width: '100%', minHeight: '200px', marginTop: '10px', padding: '8px', border: '1px solid #777', borderRadius: '4px', backgroundColor: '#333', color: 'white', fontFamily: 'monospace', fontSize: '0.9em', boxSizing: 'border-box' as const },
    button: { padding: '10px 15px', marginTop: '10px', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1em' as const },
    feedback: { marginTop: '10px', padding: '8px', color: 'white', borderRadius: '4px', fontSize: '0.9em' as const, whiteSpace: 'pre-wrap' as const },
    select: { padding: '8px', marginTop: '10px', marginRight: '10px', borderRadius: '4px', backgroundColor: '#333', color: 'white', border: '1px solid #777' }
  };

  return (
    <div style={{paddingBottom: '20px'}}>
      <h4>Settle Realms Per Zone</h4>
      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
        1. Fetch zone and season pass data. 2. Select a zone. 3. Review JSON. 4. Settle.
      </p>
      
      <button
        style={{ ...commonStyles.button, backgroundColor: '#007bff', opacity: isLoading ? 0.7 : 1 }}
        onClick={fetchAllData}
        disabled={isLoading}
      >
        {isLoading && feedback.startsWith("Fetching") ? 'Fetching Data...' : '1. Fetch location and zones data'}
      </button>

      <div>
        <label htmlFor="zoneSelect" style={{ marginRight: '5px' }}>Select Zone:</label>
        <select 
            id="zoneSelect"
            style={commonStyles.select}
            value={selectedZoneId} 
            onChange={(e) => setSelectedZoneId(Number(e.target.value))}
            disabled={isLoading || allZoneLocations.length === 0}
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map(zoneNum => (
            <option key={zoneNum} value={zoneNum}>Zone {zoneNum}</option>
          ))}
        </select>
      </div>

      {feedback && (
        <div style={{ ...commonStyles.feedback, backgroundColor: feedback.startsWith('Error:') || feedback.startsWith('Warning:') ? '#d9534f' : '#5bc0de' }}>
          {feedback}
        </div>
      )}

      <textarea
        style={commonStyles.textArea}
        value={jsonDataOutput}
        readOnly
        placeholder={'JSON output for realm settlements will appear here after selecting a zone and fetching data...'}
      />
      
      <button
        style={{ ...commonStyles.button, backgroundColor: '#28a745', opacity: isLoading || !jsonDataOutput ? 0.7 : 1 }}
        onClick={handleSettleRealms}
        disabled={isLoading || !jsonDataOutput || playerSeasonPasses.length === 0}
      >
        {isLoading && feedback.startsWith("Settling") ? 'Settling...' : `4. Settle ${JSON.parse(jsonDataOutput || "[]").length} Realms for Zone ${selectedZoneId}`}
      </button>
    </div>
  );
}; 