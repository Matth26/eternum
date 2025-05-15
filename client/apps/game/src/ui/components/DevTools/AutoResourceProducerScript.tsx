import { getBlockTimestamp } from '@/utils/timestamp';
import {
  configManager,
  divideByPrecision,
  getBalance,
  getRealmInfo
} from '@bibliothecadao/eternum';
import { useDojo } from '@bibliothecadao/react';
import { ID, ResourcesIds, StructureType } from '@bibliothecadao/types'; // Corrected import path
import { getComponentValue } from '@dojoengine/recs'; // Import getComponentValue
import React, { useCallback, useEffect, useState } from 'react';

const LABOR_RESOURCE_ID = ResourcesIds.Labor;

// Default values for sliders
const DEFAULT_PERCENTAGE_FOR_LABOR_INPUT = 0.01;
const DEFAULT_PERCENTAGE_INPUT_FOR_RESOURCES = 0.01;
const DEFAULT_PERCENTAGE_LABOR_FOR_RESOURCES = 0.01;

// localStorage keys
const STORAGE_KEY_PREFIX = 'autoResourceProducer_';
const STORAGE_KEY_INTERVAL = `${STORAGE_KEY_PREFIX}productionIntervalMins`;
const STORAGE_KEY_PERCENT_LABOR_INPUT = `${STORAGE_KEY_PREFIX}percentageForLaborInput`;
const STORAGE_KEY_PERCENT_INPUT_RESOURCES = `${STORAGE_KEY_PREFIX}percentageInputForResources`;
const STORAGE_KEY_PERCENT_LABOR_RESOURCES = `${STORAGE_KEY_PREFIX}percentageLaborForResources`;
const STORAGE_KEY_LOGS = `${STORAGE_KEY_PREFIX}logs`;
const STORAGE_KEY_IS_RUNNING = `${STORAGE_KEY_PREFIX}isRunning`;
const STORAGE_KEY_SLIDER_SETTINGS = `${STORAGE_KEY_PREFIX}sliderSettings`;

const RESOURCE_PRECISION = configManager.getResourcePrecision() || 1e18;

interface LogEntry {
  timestamp: Date;
  message: string;
  realmId?: ID;
  type: 'info' | 'error' | 'success';
}

// Type for log entries as stored in localStorage (timestamp as string)
interface RawLogEntry extends Omit<LogEntry, 'timestamp'> {
  timestamp: string;
}

// Add these style variables before the return statement
const sliderStyle: React.CSSProperties = { width: '100%', marginBottom: '5px' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '2px', fontSize: '0.9em' };
const valueStyle: React.CSSProperties = { fontSize: '0.9em', color: '#aaa', marginLeft: '10px' };

export const AutoResourceProducerScript: React.FC = () => {
  const {
    account: { account },
    setup: { components, systemCalls },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [productionPlan, setProductionPlan] = useState<any[]>([]); // Holds the result of phase 1
  const [selectedRealmId, setSelectedRealmId] = useState<ID | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<number | null>(null);
  // Per-realm, per-resource slider state
  const [sliderSettings, setSliderSettings] = useState<Record<string, Record<string, { laborInput: number; rawInput: number; laborForResource: number }>>>({});

  // Configurable state variables
  const [percentageForLaborInput, setPercentageForLaborInput] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_PERCENT_LABOR_INPUT);
    return saved ? parseFloat(saved) : DEFAULT_PERCENTAGE_FOR_LABOR_INPUT;
  });
  const [percentageInputForResources, setPercentageInputForResources] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_PERCENT_INPUT_RESOURCES);
    return saved ? parseFloat(saved) : DEFAULT_PERCENTAGE_INPUT_FOR_RESOURCES;
  });
  const [percentageLaborForResources, setPercentageLaborForResources] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_PERCENT_LABOR_RESOURCES);
    return saved ? parseFloat(saved) : DEFAULT_PERCENTAGE_LABOR_FOR_RESOURCES;
  });

  const log = useCallback((message: string, type: LogEntry['type'] = 'info', realmId?: ID) => {
    console.log(`[AutoProducer] ${realmId ? `(Realm ${realmId}) ` : ''}${message}`);
    setLogs((prevLogs: LogEntry[]) => {
      const newLogs = [{ timestamp: new Date(), message, realmId, type }, ...prevLogs].slice(0, 100);
      // localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(newLogs)); // Logs will be saved in a separate useEffect
      return newLogs;
    });
  }, []);
  
   const getMyOwnedRealms = useCallback(async () => {
    if (!account || !components?.Structure) return [];
    const ownedRealms: { name: string; entityId: ID; coord: { x: number; y: number } }[] = [];
    const structureEntities = components.Structure.entities(); // This might need to be runQuery([Has(components.Structure)]) depending on Recs/Dojo version
    for (const entityId of structureEntities) {
        const structure = getComponentValue(components.Structure, entityId); // Corrected usage
        if (structure && structure.owner && BigInt(structure.owner) === BigInt(account.address)) {
            if (Number(structure.category) === StructureType.Realm) {
              const realmInfo = getRealmInfo(entityId, components);
              // if realmInfo defined, use name from realmInfo, else use name from structure
              const name = realmInfo ? realmInfo.name : `Realm ${structure.entity_id}`;
              ownedRealms.push({
                name,
                entityId: structure.entity_id,  
                coord: { x: structure.base?.coord_x || 0, y: structure.base?.coord_y || 0 },
              });
            }
        }
    }
    return ownedRealms;
  }, [account, components?.Structure]);

  // --- PHASE 1: Data Collection & Preparation ---
  const fetchProductionPlan = useCallback(async () => {
    if (!account || !components || !systemCalls) {
      log('Dojo setup not ready or account not available.', 'error');
      return;
    }
    setIsLoading(true);
    log('Phase 1: Collecting data and preparing operations for all realms...', 'info');
    try {
      const allRealmOperations: Array<{
        realmId: ID;
        realmName: string;
        laborProdArgs: { types: ResourcesIds[], amounts: number[] } | null;
        rawReplenishArgs: { types: ResourcesIds[], cycles: number[] } | null;
        laborReplenishArgs: { types: ResourcesIds[], cycles: number[], laborBudgetPerType: number } | null;
      }> = [];
      const ownedRealms = await getMyOwnedRealms();
      if (ownedRealms.length === 0) {
        log('No owned realms found.');
        setIsLoading(false); return;
      }
      const { currentDefaultTick } = getBlockTimestamp();
      const resourcesToConsiderForLaborBurn = Object.values(ResourcesIds).filter(
            (id) => typeof id === 'number' && 
                    id !== ResourcesIds.Lords && 
                    id !== ResourcesIds.Labor && 
                    id !== ResourcesIds.AncientFragment &&
                    id !== ResourcesIds.Donkey &&
                    id !== ResourcesIds.Knight &&
                    id !== ResourcesIds.KnightT2 &&
                    id !== ResourcesIds.KnightT3 &&
                    id !== ResourcesIds.Crossbowman &&
                    id !== ResourcesIds.CrossbowmanT2 &&
                    id !== ResourcesIds.CrossbowmanT3 &&
                    id !== ResourcesIds.Paladin &&
                    id !== ResourcesIds.PaladinT2 &&
                    id !== ResourcesIds.PaladinT3 &&
                    id !== ResourcesIds.Wheat &&
                    id !== ResourcesIds.Fish &&
                    !isNaN(id)
        ) as ResourcesIds[];
      let realmCollectCount = 0;
      for (const realm of ownedRealms) {
        realmCollectCount++;
        const realmId = realm.entityId;
        const currentRealmLaborTypes: ResourcesIds[] = [];
        const currentRealmLaborAmounts: number[] = [];
        const currentRealmIntendedLaborBurnResources: ResourcesIds[] = [];
        resourcesToConsiderForLaborBurn.forEach(resourceToBurnId => {
            const laborProductionConfig = configManager.getLaborConfig(resourceToBurnId);
            if (laborProductionConfig && laborProductionConfig.laborProductionPerResource > 0) {
            const resourceBalanceRaw = getBalance(realmId, resourceToBurnId, currentDefaultTick, components).balance;
            // Use slider value if available, else default
            const slider = sliderSettings[realmId]?.[resourceToBurnId];
            const percent = slider ? slider.laborInput : percentageForLaborInput;
            const resourceToBurnNatRaw = Math.floor(Number(resourceBalanceRaw) * percent);
            let resourceToBurnNat = resourceToBurnNatRaw;
            if (resourceToBurnNat > 0 && configManager.getResourcePrecision()) {
              resourceToBurnNat = Math.floor(resourceToBurnNat / configManager.getResourcePrecision()) * configManager.getResourcePrecision();
            }
                if (resourceToBurnNat > 0) {
                    currentRealmLaborTypes.push(resourceToBurnId);
                    currentRealmLaborAmounts.push(resourceToBurnNat);
                    if (!currentRealmIntendedLaborBurnResources.includes(resourceToBurnId)) {
                         currentRealmIntendedLaborBurnResources.push(resourceToBurnId);
                    }
                }
            }
        });
        if (currentRealmLaborTypes.length > 0) {
            allRealmOperations.push({
                realmId,
                realmName: realm.name,
                laborProdArgs: {
                    types: currentRealmLaborTypes,
                    amounts: currentRealmLaborAmounts
                },
                rawReplenishArgs: null,
                laborReplenishArgs: null
            });
        }
        if (currentRealmIntendedLaborBurnResources.length > 0) {
            const availableLaborNat = divideByPrecision(getBalance(realmId, LABOR_RESOURCE_ID, currentDefaultTick, components).balance);
            const currentRealmRawTypes: ResourcesIds[] = [];
            const currentRealmRawCycles: number[] = [];
            const resourcesForLaborReplenishInRealm: ResourcesIds[] = [];
            for (const resId of currentRealmIntendedLaborBurnResources) {
                const inputs = configManager.complexSystemResourceInputs[resId];
                if (inputs && inputs.length > 0) {
                    let minCycles = Infinity; let canAfford = true;
                    for (const input of inputs) {
                        const balance = getBalance(realmId, input.resource, currentDefaultTick, components).balance;
                        const available = Math.floor(divideByPrecision(balance) * percentageInputForResources);
                        const cycles = Math.floor(available / input.amount);
                        if (cycles === 0) { canAfford = false; break; }
                        minCycles = Math.min(minCycles, cycles);
                    }
                    if (canAfford && minCycles > 0 && minCycles !== Infinity) {
                        currentRealmRawTypes.push(resId); 
                        currentRealmRawCycles.push(minCycles);
                    } else { resourcesForLaborReplenishInRealm.push(resId); }
                } else { resourcesForLaborReplenishInRealm.push(resId); }
            }
            if (currentRealmRawTypes.length > 0) {
                allRealmOperations.push({
                    realmId,
                    realmName: realm.name,
                    laborProdArgs: null,
                    rawReplenishArgs: {
                        types: currentRealmRawTypes,
                        cycles: currentRealmRawCycles
                    },
                    laborReplenishArgs: null
                });
            }
            if (resourcesForLaborReplenishInRealm.length > 0) {
                const currentRealmLaborReplenishTypes: ResourcesIds[] = [];
                const currentRealmLaborReplenishCycles: number[] = [];
                const perTypeLaborBudgetNat = resourcesForLaborReplenishInRealm.length > 0 ? Math.floor((availableLaborNat * percentageLaborForResources) / resourcesForLaborReplenishInRealm.length) : 0;
                for (const resId of resourcesForLaborReplenishInRealm) {
                    const cfg = configManager.getLaborConfig(resId);
                    if (cfg && cfg.inputResources.length > 0 && cfg.laborBurnPerResourceOutput >= 0 && cfg.resourceOutputPerInputResources > 0) {
                        let costPerCycle = 0; let hasLabor = false;
                        for (const input of cfg.inputResources) {
                            if (input.resource === LABOR_RESOURCE_ID) { costPerCycle = input.amount; hasLabor = true; break; }
                        }
                        if (!hasLabor && cfg.laborBurnPerResourceOutput > 0) costPerCycle = cfg.laborBurnPerResourceOutput * cfg.resourceOutputPerInputResources;
                        if (costPerCycle === 0 && !hasLabor) continue;
                        const cycles = costPerCycle > 0 && perTypeLaborBudgetNat > 0 ? Math.floor(perTypeLaborBudgetNat / costPerCycle) : 0;
                        if (cycles > 0) {
                            currentRealmLaborReplenishTypes.push(resId);
                            currentRealmLaborReplenishCycles.push(cycles);
                        }
                    }
                }
                if (currentRealmLaborReplenishTypes.length > 0) {
                    allRealmOperations.push({
                        realmId,
                        realmName: realm.name,
                        laborProdArgs: null,
                        rawReplenishArgs: null,
                        laborReplenishArgs: {
                            types: currentRealmLaborReplenishTypes,
                            cycles: currentRealmLaborReplenishCycles,
                            laborBudgetPerType: perTypeLaborBudgetNat
                        }
                    });
                }
            }
        }
      }
      setProductionPlan(allRealmOperations);
      log('Phase 1: Data collection complete. Ready for execution.', 'success');
    } catch (error) {
      log(`Error in phase 1: ${(error as Error).message}`, 'error');
    }
    setIsLoading(false);
  }, [account, components, systemCalls, log, getMyOwnedRealms, percentageForLaborInput, percentageInputForResources, percentageLaborForResources]);

  // --- PHASE 2: Transaction Execution ---
  const executeProductionPlan = useCallback(async () => {
    if (!account || !components || !systemCalls) {
      log('Dojo setup not ready or account not available.', 'error');
      return;
    }
    if (!productionPlan || productionPlan.length === 0) {
      log('No production plan available. Please run Phase 1 first.', 'error');
      return;
    }
    setIsLoading(true);
    log(`Phase 2: Executing batched transactions for ${productionPlan.length} prepared realm operations...`, 'info');
    try {
      let realmExecuteCount = 0;
      for (const op of productionPlan) {
        realmExecuteCount++;
        log(`Executing operations for Realm ID: ${op.realmId} (${op.realmName}) (Realm ${realmExecuteCount} of ${productionPlan.length})`, 'info', op.realmId);
        // --- Labor Production ---
        if (op.laborProdArgs) {
          // Filter by slider value
          const filteredTypes: number[] = [];
          const filteredAmounts: number[] = [];
          const precision = configManager.getResourcePrecision() || 1e18;
          op.laborProdArgs.types.forEach((resId: number, idx: number) => {
            const slider = sliderSettings[op.realmId]?.[resId];
            const percent = slider ? slider.laborInput : 0.5;
            let amt = op.laborProdArgs.amounts[idx];
            if (amt % precision !== 0) {
              const adjusted = Math.floor(amt / precision) * precision;
              if (adjusted > 0) {
                log(`Adjusted resource amount for resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}) in realm ${op.realmId} from ${amt} to ${adjusted} to match precision (${precision}). Slider: ${percent}`, 'info', op.realmId);
                amt = adjusted;
              } else {
                log(`[SKIP] Resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}) in realm ${op.realmId} skipped. Original amount: ${amt}, precision: ${precision}, slider: ${percent}`, 'info', op.realmId);
                return;
              }
            }
            log(`[LABOR_PROD] Realm ${op.realmId}, Resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}): Amount to burn: ${amt}, Slider: ${percent}`, 'info', op.realmId);
            filteredTypes.push(resId);
            filteredAmounts.push(amt);
          });
          if (filteredTypes.length > 0) {
            try {
              log(`Batch burning ${filteredTypes.length} resource types for Labor in realm ${op.realmId}.`, 'info', op.realmId);
                await systemCalls.burn_resource_for_labor_production({
                    signer: account,
                entity_id: op.realmId,
                resource_types: filteredTypes,
                resource_amounts: filteredAmounts,
              });
              log(`SUCCESS: Batch burn for Labor in realm ${op.realmId}. Resources: ${filteredTypes.map((id: ResourcesIds) => ResourcesIds[id]).join(', ')}.`, 'success', op.realmId);
            } catch (e) {
                log(`ERROR: Batch burn for Labor in realm ${op.realmId}: ${(e as Error).message}`, 'error', op.realmId);
            }
        }
        }
        // --- Raw Material Replenishment ---
        if (op.rawReplenishArgs && op.rawReplenishArgs.types.length > 0) {
          const filteredTypes: number[] = [];
          const filteredCycles: number[] = [];
          op.rawReplenishArgs.types.forEach((resId: number, idx: number) => {
            const slider = sliderSettings[op.realmId]?.[resId];
            const percent = slider ? slider.rawInput : 0.5;
            const cycles = op.rawReplenishArgs.cycles[idx];
            log(`[RAW_REPLENISH] Realm ${op.realmId}, Resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}): Cycles: ${cycles}, Slider: ${percent}`, 'info', op.realmId);
            filteredTypes.push(resId);
            filteredCycles.push(cycles);
          });
          if (filteredTypes.length > 0) {
            try {
              log(`Batch replenishing ${filteredTypes.length} resource types with raw inputs in realm ${op.realmId}.`, 'info', op.realmId);
                await systemCalls.burn_resource_for_resource_production({
                    signer: account,
                from_entity_id: op.realmId,
                produced_resource_types: filteredTypes,
                production_cycles: filteredCycles,
              });
              log(`SUCCESS: Batch replenish with raw inputs in realm ${op.realmId}. Resources: ${filteredTypes.map((id: ResourcesIds) => ResourcesIds[id]).join(', ')}.`, 'success', op.realmId);
            } catch (e) {
                log(`ERROR: Batch replenish with raw inputs in realm ${op.realmId}: ${(e as Error).message}`, 'error', op.realmId);
            }
        }
        }
        // --- Labor Replenishment ---
        if (op.laborReplenishArgs && op.laborReplenishArgs.types.length > 0) {
          const filteredTypes: number[] = [];
          const filteredCycles: number[] = [];
          op.laborReplenishArgs.types.forEach((resId: number, idx: number) => {
            const slider = sliderSettings[op.realmId]?.[resId];
            const percent = slider ? slider.laborForResource : 0.25;
            const cycles = op.laborReplenishArgs.cycles[idx];
            log(`[LABOR_REPLENISH] Realm ${op.realmId}, Resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}): Cycles: ${cycles}, Labor budget per type: ${op.laborReplenishArgs.laborBudgetPerType}, Slider: ${percent}`, 'info', op.realmId);
            filteredTypes.push(resId);
            filteredCycles.push(cycles);
          });
          if (filteredTypes.length > 0) {
            try {
              log(`Batch replenishing ${filteredTypes.length} resource types with Labor in realm ${op.realmId}.`, 'info', op.realmId);
                await systemCalls.burn_labor_for_resource_production({
                    signer: account,
                from_entity_id: op.realmId,
                produced_resource_types: filteredTypes,
                production_cycles: filteredCycles,
              });
              log(`SUCCESS: Batch replenish with Labor in realm ${op.realmId}. Resources: ${filteredTypes.map((id: ResourcesIds) => ResourcesIds[id]).join(', ')}.`, 'success', op.realmId);
            } catch (e) {
                log(`ERROR: Batch replenish with Labor in realm ${op.realmId}: ${(e as Error).message}`, 'error', op.realmId);
            }
            }
        }
        log(`All operations executed for Realm ID: ${op.realmId}`, 'info', op.realmId);
      }
    } catch (error) {
      log(`Error in phase 2: ${(error as Error).message}`, 'error');
    }
    setIsLoading(false);
  }, [account, components, systemCalls, log, productionPlan, sliderSettings]);

  useEffect(() => {
    // Load logs from localStorage on mount
    const savedLogs = localStorage.getItem(STORAGE_KEY_LOGS);
    if (savedLogs) {
      try {
        const parsedLogs = JSON.parse(savedLogs).map((logEntry: RawLogEntry) => ({
          ...logEntry,
          timestamp: new Date(logEntry.timestamp), // Rehydrate Date objects
        }));
        setLogs(parsedLogs);
      } catch (error) {
        console.error("Failed to parse logs from localStorage", error);
        localStorage.removeItem(STORAGE_KEY_LOGS); // Clear corrupted logs
      }
    }

    // Load isRunning state from localStorage on mount
    const savedIsRunning = localStorage.getItem(STORAGE_KEY_IS_RUNNING);
    if (savedIsRunning) {
      setIsLoading(savedIsRunning === 'true');
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  // Effect to save logs to localStorage whenever they change
  useEffect(() => {
    if (logs.length > 0 || localStorage.getItem(STORAGE_KEY_LOGS)) { // Save if logs exist or if there were previous logs to clear
        localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs.map((logEntry: LogEntry) => ({
            ...logEntry,
            timestamp: logEntry.timestamp.toISOString(), // Store dates as ISO strings
        }))));
    }
  }, [logs]);
  
  // Effects to save settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PERCENT_LABOR_INPUT, percentageForLaborInput.toString());
  }, [percentageForLaborInput]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PERCENT_INPUT_RESOURCES, percentageInputForResources.toString());
  }, [percentageInputForResources]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PERCENT_LABOR_RESOURCES, percentageLaborForResources.toString());
  }, [percentageLaborForResources]);
  
  // When productionPlan is set, initialize sliderSettings for all (realm, resource) pairs
  useEffect(() => {
    if (!productionPlan || productionPlan.length === 0) return;
    // Load from localStorage if available
    let loadedSettings: Record<string, Record<string, { laborInput: number; rawInput: number; laborForResource: number }>> = {};
    const saved = localStorage.getItem(STORAGE_KEY_SLIDER_SETTINGS);
    if (saved) {
      try { loadedSettings = JSON.parse(saved); } catch {}
    }
    const newSettings: Record<string, Record<string, { laborInput: number; rawInput: number; laborForResource: number }>> = { ...loadedSettings };
    for (const op of productionPlan) {
      const realmId = op.realmId.toString();
      if (!newSettings[realmId]) newSettings[realmId] = {};
      // laborProdArgs
      if (op.laborProdArgs) {
        op.laborProdArgs.types.forEach((resId: number) => {
          if (!newSettings[realmId][resId]) newSettings[realmId][resId] = {
            laborInput: percentageForLaborInput,
            rawInput: percentageInputForResources,
            laborForResource: percentageLaborForResources
          };
        });
      }
      // rawReplenishArgs
      if (op.rawReplenishArgs) {
        op.rawReplenishArgs.types.forEach((resId: number) => {
          if (!newSettings[realmId][resId]) newSettings[realmId][resId] = {
            laborInput: percentageForLaborInput,
            rawInput: percentageInputForResources,
            laborForResource: percentageLaborForResources
          };
        });
      }
      // laborReplenishArgs
      if (op.laborReplenishArgs) {
        op.laborReplenishArgs.types.forEach((resId: number) => {
          if (!newSettings[realmId][resId]) newSettings[realmId][resId] = {
            laborInput: percentageForLaborInput,
            rawInput: percentageInputForResources,
            laborForResource: percentageLaborForResources
          };
        });
      }
    }
    setSliderSettings(newSettings);
    // Set default selected realm/resource
    if (productionPlan.length > 0) {
      setSelectedRealmId(productionPlan[0].realmId);
      // Pick first resource in any args
      const op = productionPlan[0];
      let firstRes = null;
      if (op.laborProdArgs && op.laborProdArgs.types.length > 0) firstRes = op.laborProdArgs.types[0];
      else if (op.rawReplenishArgs && op.rawReplenishArgs.types.length > 0) firstRes = op.rawReplenishArgs.types[0];
      else if (op.laborReplenishArgs && op.laborReplenishArgs.types.length > 0) firstRes = op.laborReplenishArgs.types[0];
      setSelectedResourceId(firstRes);
    }
  }, [productionPlan, percentageForLaborInput, percentageInputForResources, percentageLaborForResources]);

  // Save sliderSettings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SLIDER_SETTINGS, JSON.stringify(sliderSettings));
  }, [sliderSettings]);

  // Handler for slider changes
  const handleSliderChange = (type: 'laborInput' | 'rawInput' | 'laborForResource', value: number) => {
    if (!selectedRealmId || !selectedResourceId) return;
    setSliderSettings(prev => ({
      ...prev,
      [selectedRealmId]: {
        ...prev[selectedRealmId],
        [selectedResourceId]: {
          ...prev[selectedRealmId]?.[selectedResourceId],
          [type]: value,
        },
      },
    }));
  };

  // Get available realms and resources for dropdowns
  // Deduplicate realms by realmId
  const availableRealmsMap = new Map<string, { realmId: string, realmName: string }>();
  for (const op of productionPlan) {
    const realmIdStr = op.realmId.toString();
    if (!availableRealmsMap.has(realmIdStr)) {
      availableRealmsMap.set(realmIdStr, { realmId: op.realmId, realmName: op.realmName });
    }
  }
  const availableRealms = Array.from(availableRealmsMap.values());
  const availableResources = (() => {
    if (!selectedRealmId) return [];
    // Gather all unique resources for the selected realm from all productionPlan entries
    const resMap = new Map<number, number>(); // resourceId -> total amount
    for (const op of productionPlan) {
      if (op.realmId.toString() === selectedRealmId.toString()) {
        if (op.laborProdArgs) op.laborProdArgs.types.forEach((id: number, idx: number) => {
          const amt = op.laborProdArgs.amounts?.[idx] ?? 0;
          resMap.set(id, (resMap.get(id) || 0) + amt);
        });
        if (op.rawReplenishArgs) op.rawReplenishArgs.types.forEach((id: number, idx: number) => {
          const amt = op.rawReplenishArgs.cycles?.[idx] ?? 0;
          resMap.set(id, (resMap.get(id) || 0) + amt);
        });
        if (op.laborReplenishArgs) op.laborReplenishArgs.types.forEach((id: number, idx: number) => {
          const amt = op.laborReplenishArgs.cycles?.[idx] ?? 0;
          resMap.set(id, (resMap.get(id) || 0) + amt);
        });
      }
    }
    return Array.from(resMap.entries()); // [resourceId, totalAmount]
  })();

  // Add this effect after availableResources is defined
  useEffect(() => {
    if (!selectedRealmId || !availableResources.length) return;
    // If current selectedResourceId is not in availableResources, set to first
    const resourceIds = availableResources.map(([resId]) => resId);
    if (selectedResourceId == null || !resourceIds.includes(selectedResourceId)) {
      setSelectedResourceId(resourceIds[0]);
    }
  }, [selectedRealmId, availableResources]);

  const buttonStyle: React.CSSProperties = {
    padding: '10px 15px',
    margin: '5px',
    // Base color will be overridden by isLoading or depend on isRunning
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1em',
  };

  return (
    <div style={{ fontFamily: 'monospace', padding: '10px', border: '1px solid #ccc', margin: '10px 0' }}>
      <h4>Automatic Resource Producer</h4>
      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
        This script allows you to manually fetch and execute resource production plans in two steps.
      </p>
      <button
        style={{ ...buttonStyle, backgroundColor: '#007bff', opacity: isLoading ? 0.7 : 1 }}
        onClick={fetchProductionPlan}
        disabled={isLoading || !account?.address}
      >
        {isLoading ? 'Processing...' : '1. Fetch Production Plan'}
      </button>
      {productionPlan.length > 0 && (
        <div style={{ margin: '15px 0', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}>
          <label style={labelStyle}>Select Realm:
            <select
              value={selectedRealmId ?? ''}
              onChange={e => setSelectedRealmId(e.target.value as any)}
              style={{ marginLeft: 8, background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: '4px 8px' }}
            >
              {availableRealms.map(r => (
                <option key={r.realmId} value={r.realmId} style={{ background: '#222', color: '#fff' }}>{r.realmName} ({r.realmId})</option>
              ))}
            </select>
          </label>
          {selectedRealmId && (
            <label style={labelStyle}>Select Resource:
              <select
                value={selectedResourceId ?? ''}
                onChange={e => setSelectedResourceId(Number(e.target.value))}
                style={{ marginLeft: 8, background: '#222', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: '4px 8px' }}
              >
                {availableResources.map(([resId, amount]) => (
                  <option key={`${selectedRealmId}-${resId}`} value={resId} style={{ background: '#222', color: '#fff' }}>
                    {ResourcesIds[resId] ?? resId} (amount: {divideByPrecision(amount).toLocaleString()})
                  </option>
                ))}
              </select>
        </label>
          )}
          {selectedRealmId && selectedResourceId && sliderSettings[selectedRealmId]?.[selectedResourceId] && (
            <div style={{ marginTop: 10 }}>
        <label style={labelStyle}>
          % of Input Resources for Labor Prod:
                <span style={valueStyle}>{(sliderSettings[selectedRealmId][selectedResourceId].laborInput * 100).toFixed(0)}%</span>
        </label>
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
                value={sliderSettings[selectedRealmId][selectedResourceId].laborInput * 100}
                onChange={e => handleSliderChange('laborInput', parseFloat(e.target.value) / 100)}
          style={sliderStyle}
                disabled={isLoading}
        />
        <label style={labelStyle}>
          % of Raw Inputs for Resource Prod:
                <span style={valueStyle}>{(sliderSettings[selectedRealmId][selectedResourceId].rawInput * 100).toFixed(0)}%</span>
        </label>
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
                value={sliderSettings[selectedRealmId][selectedResourceId].rawInput * 100}
                onChange={e => handleSliderChange('rawInput', parseFloat(e.target.value) / 100)}
          style={sliderStyle}
                disabled={isLoading}
        />
        <label style={labelStyle}>
          % of Labor for Resource Prod:
                <span style={valueStyle}>{(sliderSettings[selectedRealmId][selectedResourceId].laborForResource * 100).toFixed(0)}%</span>
        </label>
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
                value={sliderSettings[selectedRealmId][selectedResourceId].laborForResource * 100}
                onChange={e => handleSliderChange('laborForResource', parseFloat(e.target.value) / 100)}
          style={sliderStyle}
                disabled={isLoading}
        />
      </div>
          )}
        </div>
      )}
      <button
        style={{ ...buttonStyle, backgroundColor: '#28a745', opacity: isLoading || !productionPlan.length ? 0.7 : 1 }}
        onClick={executeProductionPlan}
        disabled={isLoading || !account?.address || !productionPlan.length}
      >
        {isLoading ? 'Processing...' : '2. Execute Production Plan'}
      </button>
      <h5>Logs:</h5>
      <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #eee', padding: '5px', background: '#f9f9f9' }}>
        {logs.length === 0 && <p>No logs yet.</p>}
        {logs.map((entry: LogEntry, index: number) => (
          <div key={index} style={{ marginBottom: '5px', paddingBottom: '5px', borderBottom: '1px dashed #ddd' }}>
            <span style={{ color: '#888', fontSize: '0.8em' }}>{entry.timestamp.toLocaleTimeString()} </span>
            {entry.realmId && <span style={{ color: 'blue', fontSize: '0.8em' }}>(Realm {entry.realmId.toString()}) </span>}
            <span style={{ color: entry.type === 'error' ? 'red' : entry.type === 'success' ? 'green' : 'black' }}>
              {entry.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}; 