import { getBlockTimestamp } from '@/utils/timestamp';
import {
  configManager,
  divideByPrecision,
  getBalance,
  getRealmInfo
} from '@bibliothecadao/eternum';
import { useDojo } from '@bibliothecadao/react';
import { ID, ResourcesIds } from '@bibliothecadao/types'; // Corrected import path
import { getComponentValue } from '@dojoengine/recs'; // Import getComponentValue
import React, { useCallback, useEffect, useState } from 'react';

const LABOR_RESOURCE_ID = ResourcesIds.Labor;

// Default values for sliders
const DEFAULT_PERCENTAGE_FOR_LABOR_INPUT = 0;
const DEFAULT_PERCENTAGE_INPUT_FOR_RESOURCES = 0;
const DEFAULT_PERCENTAGE_LABOR_FOR_RESOURCES = 0;

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

interface AutoResourceProducerScriptProps {
  log: (message: string, type?: 'info' | 'error' | 'success', script?: string) => void;
}

export const AutoResourceProducerScript: React.FC<AutoResourceProducerScriptProps> = ({ log }) => {
  const {
    account: { account },
    setup: { components, systemCalls },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);
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

  const getMyOwnedRealms = useCallback(async () => {
    if (!account || !components?.Structure) return [];
    const ownedRealms: { name: string; entityId: ID; coord: { x: number; y: number } }[] = [];
    const structureEntities = components.Structure.entities();
    for (const entityId of structureEntities) {
      const structure = getComponentValue(components.Structure, entityId);
      if (structure) {
        const ownerAddressHex = "0x" + structure.owner?.toString(16);
        const numericCategory = Number(structure.category);
        const entityIdString = structure.entity_id?.toString();
        log(`[RealmDetect] structure: owner=${ownerAddressHex}, category=${numericCategory}, entityId=${entityIdString}`);
        const realmInfo = getRealmInfo(entityId, components);
        const name = realmInfo ? realmInfo.name : `Realm ${structure.entity_id}`;
        if (ownerAddressHex && ownerAddressHex.toLowerCase() === account.address.toLowerCase()) {
          if (numericCategory === 1) { // Realm
            ownedRealms.push({
              name,
              entityId: structure.entity_id,
              coord: { x: structure.base?.coord_x || 0, y: structure.base?.coord_y || 0 },
            });
          }
        }
      }
    }
    return ownedRealms;
  }, [account, components?.Structure, log]);

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
      log(`[Phase1] allRealmOperations to setProductionPlan: ${JSON.stringify(allRealmOperations)}`, 'info');
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
        log(`Executing operations for Realm ID: ${op.realmId} (${op.realmName}) (Realm ${realmExecuteCount} of ${productionPlan.length})`, 'info', op.realmId.toString());
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
                log(`Adjusted resource amount for resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}) in realm ${op.realmId} from ${amt} to ${adjusted} to match precision (${precision}). Slider: ${percent}`, 'info', op.realmId.toString());
                amt = adjusted;
              } else {
                log(`[SKIP] Resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}) in realm ${op.realmId} skipped. Original amount: ${amt}, precision: ${precision}, slider: ${percent}`, 'info', op.realmId.toString());
                return;
              }
            }
            log(`[LABOR_PROD] Realm ${op.realmId}, Resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}): Amount to burn: ${amt}, Slider: ${percent}`, 'info', op.realmId.toString());
            filteredTypes.push(resId);
            filteredAmounts.push(amt);
          });
          if (filteredTypes.length > 0) {
            try {
              log(`Batch burning ${filteredTypes.length} resource types for Labor in realm ${op.realmId}.`, 'info', op.realmId.toString());
                await systemCalls.burn_resource_for_labor_production({
                    signer: account,
                entity_id: op.realmId,
                resource_types: filteredTypes,
                resource_amounts: filteredAmounts,
              });
              log(`SUCCESS: Batch burn for Labor in realm ${op.realmId}. Resources: ${filteredTypes.map((id: ResourcesIds) => ResourcesIds[id]).join(', ')}.`, 'success', op.realmId.toString());
            } catch (e) {
                log(`ERROR: Batch burn for Labor in realm ${op.realmId}: ${(e as Error).message}`, 'error', op.realmId.toString());
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
            log(`[RAW_REPLENISH] Realm ${op.realmId}, Resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}): Cycles: ${cycles}, Slider: ${percent}`, 'info', op.realmId.toString());
            filteredTypes.push(resId);
            filteredCycles.push(cycles);
          });
          if (filteredTypes.length > 0) {
            try {
              log(`Batch replenishing ${filteredTypes.length} resource types with raw inputs in realm ${op.realmId}.`, 'info', op.realmId.toString());
                await systemCalls.burn_resource_for_resource_production({
                    signer: account,
                from_entity_id: op.realmId,
                produced_resource_types: filteredTypes,
                production_cycles: filteredCycles,
              });
              log(`SUCCESS: Batch replenish with raw inputs in realm ${op.realmId}. Resources: ${filteredTypes.map((id: ResourcesIds) => ResourcesIds[id]).join(', ')}.`, 'success', op.realmId.toString());
            } catch (e) {
                log(`ERROR: Batch replenish with raw inputs in realm ${op.realmId}: ${(e as Error).message}`, 'error', op.realmId.toString());
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
            log(`[LABOR_REPLENISH] Realm ${op.realmId}, Resource ${resId} (${ResourcesIds[resId] ?? 'Unknown'}): Cycles: ${cycles}, Labor budget per type: ${op.laborReplenishArgs.laborBudgetPerType}, Slider: ${percent}`, 'info', op.realmId.toString());
            filteredTypes.push(resId);
            filteredCycles.push(cycles);
          });
          if (filteredTypes.length > 0) {
            try {
              log(`Batch replenishing ${filteredTypes.length} resource types with Labor in realm ${op.realmId}.`, 'info', op.realmId.toString());
                await systemCalls.burn_labor_for_resource_production({
                    signer: account,
                from_entity_id: op.realmId,
                produced_resource_types: filteredTypes,
                production_cycles: filteredCycles,
              });
              log(`SUCCESS: Batch replenish with Labor in realm ${op.realmId}. Resources: ${filteredTypes.map((id: ResourcesIds) => ResourcesIds[id]).join(', ')}.`, 'success', op.realmId.toString());
            } catch (e) {
                log(`ERROR: Batch replenish with Labor in realm ${op.realmId}: ${(e as Error).message}`, 'error', op.realmId.toString());
            }
            }
        }
        log(`All operations executed for Realm ID: ${op.realmId}`, 'info', op.realmId.toString());
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
        // Replace all setLogs and local log state with the provided log function
        // For example, replace:
        //   setLogs((prevLogs: LogEntry[]) => { ... })
        // with:
        //   log(message, type, 'AutoResourceProducer')
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
  }, [log]); // Empty dependency array ensures this runs only once on mount

  // Effect to save logs to localStorage whenever they change
  useEffect(() => {
    if (productionPlan.length > 0 || localStorage.getItem(STORAGE_KEY_LOGS)) { // Save if logs exist or if there were previous logs to clear
        localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(productionPlan.map((op: any) => ({
            ...op,
            timestamp: op.timestamp.toISOString(), // Store dates as ISO strings
        }))));
    }
  }, [productionPlan]);
  
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

  // --- EXPORT/IMPORT SETTINGS ---
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
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const exportSettings = () => {
    const data = {
      sliderSettings,
      selectedRealmId,
      selectedResourceId,
      percentageForLaborInput,
      percentageInputForResources,
      percentageLaborForResources,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resourceProducerSettings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSettings = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data.sliderSettings) setSliderSettings(data.sliderSettings);
        if (typeof data.selectedRealmId !== 'undefined') setSelectedRealmId(data.selectedRealmId);
        if (typeof data.selectedResourceId !== 'undefined') setSelectedResourceId(data.selectedResourceId);
        if (typeof data.percentageForLaborInput === 'number') setPercentageForLaborInput(data.percentageForLaborInput);
        if (typeof data.percentageInputForResources === 'number') setPercentageInputForResources(data.percentageInputForResources);
        if (typeof data.percentageLaborForResources === 'number') setPercentageLaborForResources(data.percentageLaborForResources);
        log('Settings imported successfully.', 'success');
      } catch (err) {
        log('Failed to import settings: ' + (err as Error).message, 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // --- Ensure dropdowns always show after fetching production plan or importing settings ---
  useEffect(() => {
    log('[DropdownInit] Running dropdown initialization effect', 'info');
    log(`[DropdownInit] productionPlan: ${JSON.stringify(productionPlan)}`, 'info');
    log(`[DropdownInit] sliderSettings: ${JSON.stringify(sliderSettings)}`, 'info');
    log(`[DropdownInit] selectedRealmId: ${selectedRealmId}`, 'info');
    log(`[DropdownInit] selectedResourceId: ${selectedResourceId}`, 'info');
    if (productionPlan.length > 0) {
      // If sliderSettings is empty or missing realms/resources, initialize
      let changed = false;
      const newSettings: Record<string, Record<string, { laborInput: number; rawInput: number; laborForResource: number }>> = { ...sliderSettings };
      for (const op of productionPlan) {
        const realmId = op.realmId.toString();
        if (!newSettings[realmId]) { newSettings[realmId] = {}; changed = true; log(`Initializing sliderSettings for realm ${realmId}`); }
        if (op.laborProdArgs) {
          op.laborProdArgs.types.forEach((resId: number) => {
            if (!newSettings[realmId][resId]) { newSettings[realmId][resId] = {
              laborInput: typeof percentageForLaborInput === 'number' ? percentageForLaborInput : 0.01,
              rawInput: typeof percentageInputForResources === 'number' ? percentageInputForResources : 0.01,
              laborForResource: typeof percentageLaborForResources === 'number' ? percentageLaborForResources : 0.01
            }; changed = true; log(`Initializing slider for realm ${realmId} resource ${resId}`); }
          });
        }
        if (op.rawReplenishArgs) {
          op.rawReplenishArgs.types.forEach((resId: number) => {
            if (!newSettings[realmId][resId]) { newSettings[realmId][resId] = {
              laborInput: typeof percentageForLaborInput === 'number' ? percentageForLaborInput : 0.01,
              rawInput: typeof percentageInputForResources === 'number' ? percentageInputForResources : 0.01,
              laborForResource: typeof percentageLaborForResources === 'number' ? percentageLaborForResources : 0.01
            }; changed = true; log(`Initializing slider for realm ${realmId} resource ${resId}`); }
          });
        }
        if (op.laborReplenishArgs) {
          op.laborReplenishArgs.types.forEach((resId: number) => {
            if (!newSettings[realmId][resId]) { newSettings[realmId][resId] = {
              laborInput: typeof percentageForLaborInput === 'number' ? percentageForLaborInput : 0.01,
              rawInput: typeof percentageInputForResources === 'number' ? percentageInputForResources : 0.01,
              laborForResource: typeof percentageLaborForResources === 'number' ? percentageLaborForResources : 0.01
            }; changed = true; log(`Initializing slider for realm ${realmId} resource ${resId}`); }
          });
        }
      }
      if (changed) setSliderSettings(newSettings);
      // Set default selected realm/resource if not valid
      const availableRealmIds = productionPlan.map((op: any) => op.realmId);
      let realmToSet = selectedRealmId;
      if (!selectedRealmId || !availableRealmIds.includes(selectedRealmId)) {
        realmToSet = availableRealmIds[0];
        setSelectedRealmId(realmToSet);
        log(`Set selectedRealmId to ${realmToSet} (default)`);
      }
      // Find available resources for selected realm
      const op = productionPlan.find((op: any) => op.realmId === (realmToSet || availableRealmIds[0]));
      let firstRes = null;
      if (op) {
        if (op.laborProdArgs && op.laborProdArgs.types.length > 0) firstRes = op.laborProdArgs.types[0];
        else if (op.rawReplenishArgs && op.rawReplenishArgs.types.length > 0) firstRes = op.rawReplenishArgs.types[0];
        else if (op.laborReplenishArgs && op.laborReplenishArgs.types.length > 0) firstRes = op.laborReplenishArgs.types[0];
      }
      if (!selectedResourceId || (op && !Object.keys(newSettings[op.realmId.toString()] || {}).includes(selectedResourceId.toString()))) {
        setSelectedResourceId(firstRes);
        log(`Set selectedResourceId to ${firstRes} (default)`);
      }
      // Logging for dropdown visibility issues
      if (Object.keys(newSettings).length === 0) log('Dropdowns not shown: sliderSettings is empty', 'error');
      if (!realmToSet) log('Dropdowns not shown: selectedRealmId is missing', 'error');
      if (!firstRes) log('Dropdowns not shown: no available resources for selected realm', 'error');
    }
  }, [productionPlan, sliderSettings, selectedRealmId, selectedResourceId, percentageForLaborInput, percentageInputForResources, percentageLaborForResources]);

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

  return (
    <div style={{ fontFamily: 'monospace', padding: 0, border: 'none', margin: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, marginBottom: 6 }}>
        <button
          style={buttonStyle}
          onClick={fetchProductionPlan}
          disabled={isLoading || !account?.address}
        >
          {isLoading ? 'Processing...' : 'Fetch Plan'}
        </button>
        <button
          style={{ ...buttonStyle, backgroundColor: '#28a745' }}
          onClick={executeProductionPlan}
          disabled={isLoading || !account?.address || !productionPlan.length}
        >
          {isLoading ? 'Processing...' : 'Execute Plan'}
        </button>
      </div>
      {productionPlan.length > 0 && (
        <div style={{ margin: '0 0 6px 0', padding: '6px', border: '1px solid #333', borderRadius: '4px' }}>
          <label style={labelStyle}>Realm:
            <select
              value={selectedRealmId ?? ''}
              onChange={e => setSelectedRealmId(e.target.value as any)}
              style={selectStyle}
            >
              {availableRealms.map(r => (
                <option key={r.realmId} value={r.realmId} style={{ background: '#222', color: '#fff' }}>{r.realmName} ({r.realmId})</option>
              ))}
            </select>
          </label>
          {selectedRealmId && (
            <label style={labelStyle}>Resource:
              <select
                value={selectedResourceId ?? ''}
                onChange={e => setSelectedResourceId(Number(e.target.value))}
                style={selectStyle}
              >
                {availableResources.map(([resId, amount]) => (
                  <option key={`${selectedRealmId}-${resId}`} value={resId} style={{ background: '#222', color: '#fff' }}>
                    {ResourcesIds[resId] ?? resId} (amt: {divideByPrecision(amount).toLocaleString()})
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedRealmId && selectedResourceId && sliderSettings[selectedRealmId]?.[selectedResourceId] && (
            <div style={{ marginTop: 6 }}>
              <label style={labelStyle}>
                % Labor Input:
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
                % Raw Input:
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
                % Labor for Resource:
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
    </div>
  );
}; 