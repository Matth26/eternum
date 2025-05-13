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
import { calculateDistance, configManager, getAddressName, getOffchainRealm } from "@bibliothecadao/eternum";
import { useDojo } from "@bibliothecadao/react";
import { ContractAddress, getNeighborHexes } from "@bibliothecadao/types"; // For neighbor calculation
import { gql } from "graphql-request"; // For season pass fetching
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { addAddressPadding, RpcProvider } from "starknet"; // For season pass fetching and RpcProvider

// Zone Colors Constant
const ZONE_COLORS: { [key: number]: string } = {
  1: '#be4bdb', // Bright Purple
  2: '#845ef7', // Indigo
  3: '#5c7cfa', // Bright Blue
  4: '#339af0', // Medium Blue
  5: '#22b8cf', // Cyan
  6: '#20c997', // Teal/Mint Green
  7: '#51cf66', // Bright Green
  8: '#fcc419', // Yellow
  9: '#ff922b', // Orange
  10: '#ff6b6b', // Coral/Light Red
  11: '#fa5252', // Red
  12: '#e03131'  // Deeper Red
};

// Interfaces (some might be defined elsewhere and imported)
interface SettlementLocation {
  side: number;
  layer: number;
  point: number;
  x: number; // Human-readable X (normalized)
  y: number; // Human-readable Y (normalized)
  contractX: number;
  contractY: number;
  ownerAddress?: string; // Added for occupied spots
  ownerName?: string;    // Added for occupied spots
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
    setup, 
  } = useDojo();
  
  // Destructure setup parts safely using optional chaining
  const components = setup?.components;
  const create_multiple_realms = setup?.systemCalls?.create_multiple_realms;

  // Create a memoized RpcProvider instance for fetching blocks
  const rpcProvider = useMemo(() => {
    const nodeUrl = env.VITE_PUBLIC_NODE_URL;
    if (!nodeUrl) {
      console.error("BatchRealmsPerZoneScript: VITE_PUBLIC_NODE_URL is not defined!");
      return null; // Return null if URL is missing
    }
    console.log("BatchRealmsPerZoneScript: Creating RpcProvider instance.");
    return new RpcProvider({ nodeUrl });
  }, []); 

  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string>('');
  const [jsonDataOutput, setJsonDataOutput] = useState<string>('');
  
  const [allZoneLocations, setAllZoneLocations] = useState<SettlementLocation[][]>([]);
  const [playerSeasonPasses, setPlayerSeasonPasses] = useState<SeasonPassInfo[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<number>(1); // Default to Zone 1
  
  const [maxLayers, setMaxLayersState] = useState<number | null>(null);
  const [allLocationsMap, setAllLocationsMap] = useState<Map<string, SettlementLocation> | null>(null);

  // State for settling status light
  const [settlingStartTimestamp, setSettlingStartTimestamp] = useState<number | null>(null);
  const [latestBlockTimestamp, setLatestBlockTimestamp] = useState<number | null>(null);
  const [isSettlingActive, setIsSettlingActive] = useState<boolean>(false);
  const [seasonConfigError, setSeasonConfigError] = useState<string | null>(null);
  const [pulseOpacity, setPulseOpacity] = useState<number>(1);


  // TODO: Implement fetchAllData function (Step 2 & 3 from plan)
  const fetchAllData = useCallback(async () => {
    if (!account || !components || !account.address) { 
      setFeedback("Error: Account address or Dojo components not available. Please connect wallet and ensure setup is complete.");
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
      const occupiedLocationsResult = await getOccupiedLocations(ContractAddress(account.address), components, generatedLocationsMap);
      
      const occupiedLocationsWithOwnerData = occupiedLocationsResult.map(loc => {
        const ownerAddress = loc.ownerAddress; // Assuming getOccupiedLocations will be updated to return this
        let ownerName = undefined;
        if (ownerAddress && components) {
          ownerName = getAddressName(ContractAddress(ownerAddress), components);
        }
        return {
          x: loc.x, // These are contractX from getOccupiedLocations
          y: loc.y, // These are contractY from getOccupiedLocations
          ownerAddress,
          ownerName
        };
      });

      const occupiedCoords = new Set(occupiedLocationsWithOwnerData.map(loc => `${loc.x},${loc.y}`)); 
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

      // Log allBanks details
      console.log(`fetchAllData: allBanks count: ${allBanks.length}`);
      console.log(`fetchAllData: allBanks content (first 3 coordinates):`, allBanks.slice(0,3).map(b => ({x: b.contractX, y: b.contractY })));

      // Determine the target banks for Zones 7-12
      const targetBanksForZones7to12 = allBanks.slice(0, 6); // Use first 6 banks
      console.log(`fetchAllData: Using ${targetBanksForZones7to12.length} banks for Zones 7-${7 + targetBanksForZones7to12.length - 1}.`);
      targetBanksForZones7to12.forEach((bank, index) => {
          console.log(`  Bank ${index + 1} (for Zone ${7 + index}): Layer ${bank.layer}, Pos (${bank.contractX}, ${bank.contractY})`);
      });

      if (allBanks.length < 6) {
        // Adjust warning based on actual banks needed now
        console.warn(`fetchAllData: Only ${allBanks.length} banks found. Need 6 for all bank zones 7-12. Some zones will be empty.`); 
        setFeedback(`Warning: Only ${allBanks.length} banks found. Need 6 for Zones 7-12.`);
      }
      
      setFeedback("Processing zone locations based on AVAILABLE spots...");

      // Define center for distance calculations
      const gameCenter = { x: 0, y: 0 }; 

      // Prepare candidate lists for each zone type
      let zone1to6Candidates: SettlementLocation[][] = [];
      for (let side = 0; side < 6; side++) {
        
        const locationsForThisSide = availableGeneratedLocationsArray.filter(loc => loc.side === side);

        // Corrected sorting: primary by layer, secondary by point
        const sortedSideLocations = locationsForThisSide.sort((a, b) => {
          if (a.layer !== b.layer) {
            return a.layer - b.layer; // Ascending layer number
          }
          return a.point - b.point; // Ascending point number as tie-breaker
        });
        
        // Logging for verification of this new sort (for ALL sides 0-5)
        if (side >= 0 && side <= 5) { // Check all side-based zones
            console.log(`fetchAllData: Side ${side} (Zone ${side + 1}) - AFTER new sort (first 5 candidates):`, 
                sortedSideLocations.slice(0,5).map(loc => ({side: loc.side, layer: loc.layer, point: loc.point, x: loc.contractX, y: loc.contractY}))
            );
        }

        zone1to6Candidates.push(sortedSideLocations);
      }
      console.log("fetchAllData: Finished zone1to6Candidates loop. Total sides processed:", zone1to6Candidates.length);

      // Generate candidate lists for BANK ZONES (7-12)
      let zone7to12Candidates: SettlementLocation[][] = [];
      for (const [index, targetBank] of targetBanksForZones7to12.entries()) {
        const bankZoneNumber = 7 + index;
        const bankIdentifier = `Bank ${index + 1} (Zone ${bankZoneNumber})`; // Use 1-based index for logging
        console.log(`fetchAllData: Processing ${bankIdentifier} (Layer ${targetBank?.layer}) for bank zone candidates.`);

        // Check if the target bank has a valid layer property
        if (!targetBank || typeof targetBank.layer !== 'number' || isNaN(targetBank.layer)) {
            console.warn(`fetchAllData: Target ${bankIdentifier} does not have a valid layer (${targetBank?.layer}). Skipping generation for this bank zone.`);
            zone7to12Candidates.push([]); // Add empty list for this zone
            continue;
        }
        const bankLayer = targetBank.layer;
        // console.log(`  Using Bank Layer ${bankLayer} for center distance constraint.`); // Redundant log line

        // Filter using LAYERS, with specific adjustment based on bank side
        const filteredLocations = availableGeneratedLocationsArray
          .filter(loc => {
            // Ensure location has a valid layer
            if (typeof loc.layer !== 'number' || isNaN(loc.layer)) {
                console.warn(`fetchAllData: Location ${loc.contractX},${loc.contractY} missing valid layer.`);
                return false;
            }
            
            // --- MODIFIED FILTER LOGIC --- 
            // Apply layer constraint based on the bank's SIDE
            const bankSide = targetBank.side; // Get the side of the current bank being processed
            const isEastOrWestBank = (bankSide === 1 || bankSide === 4); // Check if it's East (1) or West (4)

            // Apply stricter filter (bankLayer - 2) for East/West banks, standard filter (bankLayer) otherwise.
            const maxAllowedLayer = isEastOrWestBank ? bankLayer - 2 : bankLayer; // Flipped the condition results
            // --- END MODIFIED FILTER LOGIC --- 
            
            // Apply the calculated max layer constraint
            return loc.layer <= maxAllowedLayer; 
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
        
        // Log first few candidates for verification (e.g., for Zone 7 / Bank 1)
        // Modify log to match new structure
        console.log(`  fetchAllData: ${bankIdentifier} - AFTER LAYER FILTER & BANK DIST SORT (first 5 candidates):`, 
            bankZoneLocations.slice(0,5).map(loc => ({layer: loc.layer, distToBank: calculateDistance(loc, targetBank).toFixed(2), x: loc.contractX, y: loc.contractY}))
        );           

        zone7to12Candidates.push(bankZoneLocations);
      }
      // Ensure 6 lists exist even if banks < 6
      while(zone7to12Candidates.length < 6) {
          zone7to12Candidates.push([]);
      }

      // Combine side-based and new bank-based lists (total 12 zones)
      const allZoneCandidateLists = [...zone1to6Candidates, ...zone7to12Candidates]; 

      const finalProcessedZones: SettlementLocation[][] = Array(12).fill(null).map(() => []); // Initialize for 12 zones
      const allocatedContractCoords = new Set<string>();

      // Define the new processing order: Side zones 1-6, then Bank zones 7-12
      const processingOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // Indices for 12 zones

      console.log("[fetchAllData] Using new zone processing order (12 zones):", processingOrder.map(i => `Zone ${i+1}`).join(", "));

      for (const zoneIndexInAllCandidatesList of processingOrder) { // Iterate in the defined order (0-11)
        const currentZoneCandidates = allZoneCandidateLists[zoneIndexInAllCandidatesList] || []; 

        // Enhanced logging for each zone being processed (Updated for 12 zones)
        let currentProcessingZoneLabelDetail = "Unknown Zone Type";
        let baseZoneIdForDisplay = zoneIndexInAllCandidatesList + 1; 

        if (zoneIndexInAllCandidatesList >= 0 && zoneIndexInAllCandidatesList <= 5) { // Side-based zones 1-6
            const sideLabels = ["Side 0 (NE)", "Side 1 (E)", "Side 2 (SE)", "Side 3 (SW)", "Side 4 (W)", "Side 5 (NW)"];
            currentProcessingZoneLabelDetail = `${sideLabels[zoneIndexInAllCandidatesList]} (corresponds to Zone ${baseZoneIdForDisplay})`;
        } else if (zoneIndexInAllCandidatesList >= 6 && zoneIndexInAllCandidatesList <= 11) { // Bank-based zones 7-12
            const bankIndex = zoneIndexInAllCandidatesList - 6; // 0-based index for the bank used
            currentProcessingZoneLabelDetail = `Bank ${bankIndex + 1} (corresponds to Zone ${baseZoneIdForDisplay})`;
        }
            
        console.log(`[fetchAllData - Allocation for ${currentProcessingZoneLabelDetail}] Processing ${currentZoneCandidates.length} candidates.`);
        let alreadyAllocatedCount = 0;
        let newToThisZoneCount = 0;
        // Log first 3 candidates for side zones only
        if (currentZoneCandidates.length > 0 && zoneIndexInAllCandidatesList <=5) {
            console.log(`  First 3 candidates for ${currentProcessingZoneLabelDetail} (side, layer, point, x, y):`, 
                currentZoneCandidates.slice(0,3).map(c => ({side: c.side, layer: c.layer, point: c.point, x:c.contractX, y:c.contractY}))
            );
        }

        for(const cand of currentZoneCandidates) {
            if(allocatedContractCoords.has(`${cand.contractX},${cand.contractY}`)) {
              alreadyAllocatedCount++;
            } else {
              newToThisZoneCount++;
            }
        }
        console.log(`  [fetchAllData - Allocation for ${currentProcessingZoneLabelDetail}] Of these ${currentZoneCandidates.length} candidates, ${alreadyAllocatedCount} were already allocated. ${newToThisZoneCount} are new potential spots (up to 50).`);
        

        // Original allocation logic per zone, now using zoneIndexInAllCandidatesList (0-11)
        for (const candidateLoc of currentZoneCandidates) {
          if (finalProcessedZones[zoneIndexInAllCandidatesList].length >= 50) { 
            break; 
          }

          const coordString = `${candidateLoc.contractX},${candidateLoc.contractY}`;
          if (!allocatedContractCoords.has(coordString)) {
            finalProcessedZones[zoneIndexInAllCandidatesList].push(candidateLoc); // And here
            allocatedContractCoords.add(coordString);
            // addedCount++; // This variable was per-zone, ensure it's handled if needed, or remove if not used.
                         // Currently, it's not used outside this inner loop for any feedback.
          }
        }
      }
      setAllZoneLocations(finalProcessedZones); // finalProcessedZones now has 12 elements

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

  // Fetch season config for settling status
  useEffect(() => {
    try {
      const config = configManager.getSeasonConfig();
      if (config && typeof config.startSettlingAt !== 'undefined' && config.startSettlingAt !== null) {
        setSettlingStartTimestamp(Number(config.startSettlingAt));
      } else {
        console.warn("BatchRealmsPerZoneScript: startSettlingAt not found in season config or is null/undefined.");
        setSeasonConfigError("Could not retrieve settling start time from config.");
        setSettlingStartTimestamp(null); // Ensure it's null if not found
      }
    } catch (e) {
      console.error("BatchRealmsPerZoneScript: Error fetching season config:", e);
      setSeasonConfigError("Error fetching season config for status light.");
      setSettlingStartTimestamp(null);
    }
  }, []);

  // Interval to update block timestamp and settling status using specific RpcProvider
  useEffect(() => {
    if (!rpcProvider) {
      console.log("BatchRealmsPerZoneScript: [Polling Effect] RpcProvider not available (missing URL?).");
      setSeasonConfigError("RPC provider not configured");
      setIsSettlingActive(false);
      setLatestBlockTimestamp(null);
      return;
    }
    if (settlingStartTimestamp === null) {
      console.log("BatchRealmsPerZoneScript: [Polling Effect] Settling start timestamp not set.");
      setIsSettlingActive(false);
      setLatestBlockTimestamp(null); 
      return;
    }
    
    console.log("BatchRealmsPerZoneScript: [Polling Effect] RPC Provider and start time available. Setting up interval.");
    let isMounted = true;

    const fetchAndUpdateStatus = async () => {
      if (!isMounted) return; 
      console.log("BatchRealmsPerZoneScript: [Interval] Attempting to fetch latest block via RpcProvider...");
      try {
        // Use the manually created rpcProvider
        const block = await rpcProvider.getBlock('latest'); 
        if (!isMounted) return;
        console.log("BatchRealmsPerZoneScript: [Interval] Fetched block:", block);
        const currentChainTimestamp = block.timestamp;
        console.log("BatchRealmsPerZoneScript: [Interval] Current chain timestamp:", currentChainTimestamp);
        setLatestBlockTimestamp(currentChainTimestamp);

        const isActive = currentChainTimestamp >= settlingStartTimestamp;
        setIsSettlingActive(isActive);
        console.log(`BatchRealmsPerZoneScript: [Interval] Settling active? ${isActive} (Chain: ${currentChainTimestamp}, Start: ${settlingStartTimestamp})`);
         
      } catch (err) {
        if (!isMounted) return;
        console.error("BatchRealmsPerZoneScript: [Interval] Error fetching latest block timestamp via RpcProvider:", err);
        setSeasonConfigError("Failed to fetch block time");
        setIsSettlingActive(false);
        const clientNow = Math.floor(Date.now()/1000);
        setLatestBlockTimestamp(clientNow); 
        console.log("BatchRealmsPerZoneScript: [Interval] Error fetching block time, falling back to client time for display:", clientNow);
      }
    };

    fetchAndUpdateStatus(); 
    const intervalId = setInterval(fetchAndUpdateStatus, 5000); 

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      console.log("BatchRealmsPerZoneScript: [Polling Effect] Interval cleared.");
    };
  // Rerun this effect only if the provider instance or settling time changes
  // Since rpcProvider is memoized with [], it won't cause re-runs unless env URL changed, which is unlikely.
  }, [rpcProvider, settlingStartTimestamp]); 

  // Effect for pulsing the light (red or green)
  useEffect(() => {
    let animationFrameId: number | null = null;
    if (settlingStartTimestamp !== null) { // Pulse if timestamp is known
      const pulse = (timestamp: number) => {
        const minOpacity = 0.6;
        const maxOpacity = 1.0;
        const range = maxOpacity - minOpacity;
        const cycle = (Math.sin(timestamp / 500) + 1) / 2; 
        setPulseOpacity(minOpacity + cycle * range);
        animationFrameId = requestAnimationFrame(pulse);
      };
      animationFrameId = requestAnimationFrame(pulse);
    } else {
      setPulseOpacity(1); 
      // No need to cancel frame here, as it wouldn't have started
    }
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [settlingStartTimestamp]);

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
    
    if (selectedZoneId === 8) {
        console.log(`[Zone 8 Debug] Initial locations count: ${locationsForThisZone.length}`);
    }

    setFeedback(`Generating settlement plan for Zone ${selectedZoneId} with ${playerSeasonPasses.length} passes and ${locationsForThisZone.length} locations...`);

    const settlementPlan: RealmSettlementInput[] = [];
    let availableSpotsInZone = [...locationsForThisZone];

    const wonderPasses = playerSeasonPasses.filter((p: SeasonPassInfo) => {
        const realm = getOffchainRealm(Number(p.tokenId)); // getOffchainRealm needs number
        const isWonder = realm?.wonder;
        // New Log for Wonder Pass Identification
        if (selectedZoneId === 8) {
            console.log(`[generateSettlement - Wonder Filter Debug] Pass ID ${p.realmId} (Token ID ${p.tokenId}): getOffchainRealm returns ${realm ? `object with wonder: ${realm.wonder}` : 'null'}. Evaluated as Wonder: ${!!isWonder}`);
        }
        return !!isWonder; // Ensure boolean
    });
    const normalPasses = playerSeasonPasses.filter((p: SeasonPassInfo) => {
        const realm = getOffchainRealm(Number(p.tokenId));
        return !realm?.wonder;
    });
    
    if (selectedZoneId === 8) {
        console.log(`[Zone 8 Debug] Wonder passes: ${wonderPasses.length}, Normal passes: ${normalPasses.length}`);
    }

    // Place wonders first
    wonderPasses.forEach((pass: SeasonPassInfo) => {
        let spotAssigned: SettlementLocation | null = null;
        let spotIndex = -1;
        let usedShiftFallback = false;

        if (selectedZoneId === 8) {
            console.log(`[Zone 8 Debug] Processing WONDER pass ${pass.realmId}. Spots remaining: ${availableSpotsInZone.length}`);
        }

        let placed = false;
        for (let i = 0; i < availableSpotsInZone.length; i++) {
            const spot = availableSpotsInZone[i];
            const neighborCount = countPotentialNeighbors(spot, allLocationsMap);
             if (selectedZoneId === 8 && i < 5) { // Log check for first few spots
                console.log(`[Zone 8 Debug] Wonder Check: Spot ${i} (${spot.contractX},${spot.contractY}), Neighbors: ${neighborCount}`);
            }
            if (neighborCount === 6) {
                const realmData = getOffchainRealm(Number(pass.tokenId));
                if (realmData) {
                    if (selectedZoneId === 8) console.log(`[Zone 8 Debug] Found 6-neighbor spot for wonder ${pass.realmId} at index ${i}`);
                    spotAssigned = spot;
                    spotIndex = i;
                    settlementPlan.push({
                        realm_id: realmData.realmId,
                        realm_settlement: { side: spot.side, layer: spot.layer, point: spot.point }
                    });
                    // Remove spot using splice ONLY if found this way
                    availableSpotsInZone.splice(i, 1); 
                    placed = true;
                    break;
                }
            }
        }
        
        // Fallback: if no wonder spot found, place normally using shift()
        if (!placed) {
            usedShiftFallback = true;
            const spot = availableSpotsInZone.shift(); // Takes from the START of the array
            if (spot) {
                const realmData = getOffchainRealm(Number(pass.tokenId));
                 if (realmData) {
                    if (selectedZoneId === 8) console.log(`[Zone 8 Debug] No 6-neighbor spot found for wonder ${pass.realmId}. Using shift() fallback.`);
                    spotAssigned = spot;
                    settlementPlan.push({
                        realm_id: realmData.realmId,
                        realm_settlement: { side: spot.side, layer: spot.layer, point: spot.point }
                    });
                } else {
                    if (selectedZoneId === 8) console.warn(`[Zone 8 Debug] Wonder Fallback: Could not get realm data for pass ${pass.realmId}`);
                }
            } else {
                 setFeedback(`Warning: Not enough spots in Zone ${selectedZoneId} for wonder realm ${pass.realmId}`);
                 if (selectedZoneId === 8) console.warn(`[Zone 8 Debug] Wonder Fallback: No spots left via shift() for pass ${pass.realmId}`);
            }
        }
        if (selectedZoneId === 8) {
            console.log(`[Zone 8 Debug] WONDER pass ${pass.realmId} assigned to: ${spotAssigned ? `(${spotAssigned.contractX},${spotAssigned.contractY})` : 'None'}. Method: ${placed ? `Splice@${spotIndex}` : (usedShiftFallback ? 'ShiftFallback' : 'Error?')}. Spots remaining: ${availableSpotsInZone.length}`);
        }
    });

    // Place normal passes
    normalPasses.forEach((pass: SeasonPassInfo) => {
        let spotAssigned: SettlementLocation | null = null;
        if (selectedZoneId === 8) {
            console.log(`[Zone 8 Debug] Processing NORMAL pass ${pass.realmId}. Spots remaining: ${availableSpotsInZone.length}`);
        }
        const spot = availableSpotsInZone.shift(); // Takes from the START of the array
        if (spot) {
            const realmData = getOffchainRealm(Number(pass.tokenId));
            if (realmData) {
                spotAssigned = spot;
                settlementPlan.push({
                    realm_id: realmData.realmId,
                    realm_settlement: { side: spot.side, layer: spot.layer, point: spot.point }
                });
            } else {
                 if (selectedZoneId === 8) console.warn(`[Zone 8 Debug] Normal: Could not get realm data for pass ${pass.realmId}`);
            }
        } else {
            setFeedback(`Warning: Not enough spots in Zone ${selectedZoneId} for normal realm ${pass.realmId}`);
             if (selectedZoneId === 8) console.warn(`[Zone 8 Debug] Normal: No spots left via shift() for pass ${pass.realmId}`);
        }
         if (selectedZoneId === 8) {
            console.log(`[Zone 8 Debug] NORMAL pass ${pass.realmId} assigned to: ${spotAssigned ? `(${spotAssigned.contractX},${spotAssigned.contractY})` : 'None'}. Spots remaining: ${availableSpotsInZone.length}`);
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
      setFeedback('Error: Account or system call (create_multiple_realms) not available.');
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
    // Updated initial feedback
    setFeedback(`Preparing to settle ${parsedData.length} realms for Zone ${selectedZoneId}...`);

    try {
      if (!env || !env.VITE_PUBLIC_CLIENT_FEE_RECIPIENT) {
        throw new Error('Client fee recipient address is not configured in env.');
      }
      const seasonPassAddress = await getSeasonPassAddress(); // Get dynamically

      let settledCount = 0;
      for (const [index, realmInput] of parsedData.entries()) {
        // Update feedback for each realm
        setFeedback(`Settling realm ${realmInput.realm_id} (${index + 1}/${parsedData.length}) in Zone ${selectedZoneId}...`);
        await create_multiple_realms({
          realms: [realmInput], // Pass a single realm object in an array
          owner: account.address,
          frontend: env.VITE_PUBLIC_CLIENT_FEE_RECIPIENT,
          signer: account, 
          season_pass_address: seasonPassAddress, 
        });
        settledCount++;
      }
      // Updated success feedback
      setFeedback(`Successfully settled ${settledCount} of ${parsedData.length} realm(s) in Zone ${selectedZoneId}.`);
    } catch (error) {
      console.error("Error settling realms:", error);
      // The feedback will show the error that stopped the process
      setFeedback(`Error during settlement: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Styles (can be reused or defined in a common place)
  const commonStyles = {
    textArea: { width: '100%', minHeight: '200px', marginTop: '10px', padding: '8px', border: '1px solid #777', borderRadius: '4px', backgroundColor: '#333', color: 'white', fontFamily: 'monospace', fontSize: '0.9em', boxSizing: 'border-box' as const },
    button: { padding: '10px 15px', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1em' as const },
    feedback: { marginTop: '10px', padding: '8px', color: 'white', borderRadius: '4px', fontSize: '0.9em' as const, whiteSpace: 'pre-wrap' as const },
    select: { padding: '8px', marginTop: '10px', marginRight: '10px', borderRadius: '4px', backgroundColor: '#333', border: '1px solid #777' },
    light: {
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      marginRight: '10px',
      border: '1px solid #444',
    },
    controlsContainer: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const },
    buttonRowContainer: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, marginTop: '10px' },
    settleControlsContainer: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, marginTop: '20px' }
  };

  const lightColor = settlingStartTimestamp === null ? '#FFA500' : (isSettlingActive ? '#4CAF50' : '#F44336');

  return (
    <div style={{paddingBottom: '20px'}}>
      <h4>Settle Realms Per Zone</h4>

      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
        1. Fetch zone and season pass data. 2. Select a zone. 
        <br /> 
        3. Review JSON. 4. Settle.
      </p>
      
      {/* Container for Fetch and Export Buttons */}
      <div style={commonStyles.buttonRowContainer}>
        <button
          style={{ ...commonStyles.button, backgroundColor: '#007bff', opacity: isLoading ? 0.7 : 1, /*marginTop: '10px' REMOVED */ }}
          onClick={fetchAllData}
          disabled={isLoading}
        >
          {isLoading && feedback.startsWith("Fetching") ? 'Fetching Data...' : '1. Fetch locations'}
        </button>
      </div>

      {/* Container for Zone Selector - Now separate */}
      <div style={{ marginTop: '10px' }}> 
        <label htmlFor="zoneSelect" style={{ marginRight: '5px' }}>2. Select Zone:</label>
        <select
            id="zoneSelect"
            style={{ 
              ...commonStyles.select, 
              color: ZONE_COLORS[selectedZoneId] || 'white' // Dynamically set text color
            }}
            value={selectedZoneId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedZoneId(Number(e.target.value))}
            disabled={isLoading || allZoneLocations.length === 0}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map(zoneNum => (
            <option 
              key={zoneNum} 
              value={zoneNum} 
              // Apply color style to option text
              style={{ color: ZONE_COLORS[zoneNum] || 'white' }} 
            >
              {`Zone ${zoneNum}`}
            </option>
          ))}
        </select>
      </div>

      {/* Feedback Display */}
      {feedback && (
        <div style={{ ...commonStyles.feedback, backgroundColor: feedback.startsWith('Error:') || feedback.startsWith('Warning:') ? '#d9534f' : '#5bc0de' }}>
          {feedback}
        </div>
      )}

      <textarea
        style={commonStyles.textArea}
        value={jsonDataOutput}
        onChange={(e) => setJsonDataOutput(e.target.value)}
        placeholder={'JSON output for realm settlements will appear here after selecting a zone and fetching data...'}
      />
      
      <div style={commonStyles.settleControlsContainer}>
        <div style={{ 
            ...commonStyles.light, 
            backgroundColor: lightColor, 
            opacity: settlingStartTimestamp !== null ? pulseOpacity : 1 
        }}></div>

        <button
          style={{ ...commonStyles.button, backgroundColor: '#28a745', opacity: isLoading || !jsonDataOutput ? 0.7 : 1 }}
          onClick={handleSettleRealms}
          disabled={isLoading || !jsonDataOutput || playerSeasonPasses.length === 0 || !isSettlingActive || settlingStartTimestamp === null}
        >
          {isLoading && feedback.startsWith("Settling") ? 'Settling...' : `4. Settle ${JSON.parse(jsonDataOutput || "[]").length} Realms for Zone ${selectedZoneId}`}
        </button>

        {/* Display latest fetched block timestamp */} 
        {latestBlockTimestamp !== null && (
          <span style={{fontSize: '0.7em', marginLeft: '10px', color: '#aaa'}}>
            (Current block @ {latestBlockTimestamp} - Settling @ {settlingStartTimestamp})
          </span>
        )}
      </div>
    </div>
  );
}; 