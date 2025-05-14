import { getBlockTimestamp } from '@/utils/timestamp';
import {
  configManager,
  divideByPrecision,
  getBalance
} from '@bibliothecadao/eternum';
import { useDojo } from '@bibliothecadao/react';
import { ID, ResourcesIds, StructureType } from '@bibliothecadao/types'; // Corrected import path
import { getComponentValue } from '@dojoengine/recs'; // Import getComponentValue
import React, { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';

const LABOR_RESOURCE_ID = ResourcesIds.Labor;

// Default values for sliders
const DEFAULT_PRODUCTION_INTERVAL_MIN = 5; // minutes
const DEFAULT_PERCENTAGE_FOR_LABOR_INPUT = 0.5; 
const DEFAULT_PERCENTAGE_INPUT_FOR_RESOURCES = 0.5; 
const DEFAULT_PERCENTAGE_LABOR_FOR_RESOURCES = 0.25; 

// localStorage keys
const STORAGE_KEY_PREFIX = 'autoResourceProducer_';
const STORAGE_KEY_INTERVAL = `${STORAGE_KEY_PREFIX}productionIntervalMins`;
const STORAGE_KEY_PERCENT_LABOR_INPUT = `${STORAGE_KEY_PREFIX}percentageForLaborInput`;
const STORAGE_KEY_PERCENT_INPUT_RESOURCES = `${STORAGE_KEY_PREFIX}percentageInputForResources`;
const STORAGE_KEY_PERCENT_LABOR_RESOURCES = `${STORAGE_KEY_PREFIX}percentageLaborForResources`;
const STORAGE_KEY_LOGS = `${STORAGE_KEY_PREFIX}logs`;
const STORAGE_KEY_IS_RUNNING = `${STORAGE_KEY_PREFIX}isRunning`;

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

export const AutoResourceProducerScript: React.FC = () => {
  const {
    account: { account },
    setup: { components, systemCalls },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Configurable state variables
  const [productionIntervalMins, setProductionIntervalMins] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_INTERVAL);
    return saved ? parseFloat(saved) : DEFAULT_PRODUCTION_INTERVAL_MIN;
  });
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

  const stopCycleRef = useRef<boolean>(false); // Ref to signal stopping the current cycle

  const productionIntervalMs = productionIntervalMins * 60 * 1000;

  // Ref to track the previous state of isRunning to control specific log messages
  const prevIsRunningRef = useRef(isRunning);

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
                 ownedRealms.push({
                    name: `Realm ${structure.entity_id}`, 
                    entityId: structure.entity_id,
                    coord: { x: structure.base?.coord_x || 0, y: structure.base?.coord_y || 0 }, 
                });
            }
        }
    }
    return ownedRealms;
  }, [account, components?.Structure]);

  const processProductionCycle = useCallback(async () => {
    if (!account || !components || !systemCalls) {
      log('Dojo setup not ready or account not available.', 'error');
      return;
    }
    setIsLoading(true);
    stopCycleRef.current = false; // Reset stop flag at the beginning of a cycle
    log('Starting auto production cycle with current settings...');

    try {
      // --- Phase 1: Data Collection & Preparation (All Realms) ---
      log('Phase 1: Collecting data and preparing operations for all realms...', 'info');
      const allRealmOperations: Array<{
        realmId: ID;
        realmName: string;
        laborProdArgs: { types: ResourcesIds[], amounts: number[] } | null;
        rawReplenishArgs: { types: ResourcesIds[], cycles: number[] } | null;
        laborReplenishArgs: { types: ResourcesIds[], cycles: number[], laborBudgetPerType: number } | null;
      }> = [];
      
      const ownedRealms = await getMyOwnedRealms();
      if (stopCycleRef.current) {
        log('Production cycle stopped by user during realm discovery.', 'info');
        setIsLoading(false); return;
      }
      if (ownedRealms.length === 0) {
        log('No owned realms found.');
        setIsLoading(false); return;
      }
      const { currentDefaultTick } = getBlockTimestamp();

      // Define resourcesToConsiderForLaborBurn once, before the loop
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

      log(`Phase 1: Starting data collection for ${ownedRealms.length} realms...`, 'info');
      let realmCollectCount = 0;
      for (const realm of ownedRealms) {
        realmCollectCount++;
        if (stopCycleRef.current) {
          log('Data collection stopped by user during realm iteration.', 'info', realm.entityId);
          break;
        }
        const realmId = realm.entityId;
        log(`Collecting data for Realm ID: ${realmId} (${realm.name}) (Realm ${realmCollectCount} of ${ownedRealms.length})`, 'info', realmId);

        const currentRealmLaborTypes: ResourcesIds[] = [];
        const currentRealmLaborAmounts: number[] = [];
        const currentRealmIntendedLaborBurnResources: ResourcesIds[] = [];

        resourcesToConsiderForLaborBurn.forEach(resourceToBurnId => {
            const laborProductionConfig = configManager.getLaborConfig(resourceToBurnId);
            if (laborProductionConfig && laborProductionConfig.laborProductionPerResource > 0) {
                const resourceBalance = getBalance(realmId, resourceToBurnId, currentDefaultTick, components).balance;
                const resourceToBurnNat = Math.floor(divideByPrecision(resourceBalance) * percentageForLaborInput);
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

        // Replenishment data collection (only if this realm intended to burn for labor)
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
      log('Phase 1: Data collection complete.', 'info');
      if (stopCycleRef.current) {
          log('Cycle stopped by user after data collection phase.', 'info');
          setIsLoading(false); return;
      }

      // --- Phase 2: Transaction Execution (Sequentially Per Realm, Batched within Realm) ---
      log(`Phase 2: Executing batched transactions sequentially for ${allRealmOperations.length} prepared realm operations...`, 'info');
      let realmExecuteCount = 0;
      for (const op of allRealmOperations) {
        realmExecuteCount++;
        if (stopCycleRef.current) {
          log('Transaction execution phase stopped by user.', 'info', op.realmId);
          break;
        }
        log(`Executing operations for Realm ID: ${op.realmId} (${op.realmName}) (Realm ${realmExecuteCount} of ${allRealmOperations.length})`, 'info', op.realmId);

        // Execute Labor Production for this realm if args exist
        if (op.laborProdArgs) {
            if (stopCycleRef.current) { log('Skipping labor production for realm due to stop signal.', 'info', op.realmId); break; }
            try {
                log(`Batch burning ${op.laborProdArgs.types.length} resource types for Labor in realm ${op.realmId}.`, 'info', op.realmId);
                await systemCalls.burn_resource_for_labor_production({
                    signer: account,
                    entity_id: op.realmId, // Single realm ID
                    resource_types: op.laborProdArgs.types, // Array of types for this realm
                    resource_amounts: op.laborProdArgs.amounts, // Array of amounts for this realm
                });
                log(`SUCCESS: Batch burn for Labor in realm ${op.realmId}. Resources: ${op.laborProdArgs.types.map(id => ResourcesIds[id]).join(', ')}.`, 'success', op.realmId);
            } catch (e) {
                log(`ERROR: Batch burn for Labor in realm ${op.realmId}: ${(e as Error).message}`, 'error', op.realmId);
            }
        }

        // Execute Raw Material Replenishment for this realm if args exist
        if (op.rawReplenishArgs && op.rawReplenishArgs.types.length > 0) {
            if (stopCycleRef.current) { log('Skipping raw material replenishment for realm due to stop signal.', 'info', op.realmId); break; }
            try {
                log(`Batch replenishing ${op.rawReplenishArgs.types.length} resource types with raw inputs in realm ${op.realmId}.`, 'info', op.realmId);
                await systemCalls.burn_resource_for_resource_production({
                    signer: account,
                    from_entity_id: op.realmId, // Single realm ID
                    produced_resource_types: op.rawReplenishArgs.types, // Array of types for this realm
                    production_cycles: op.rawReplenishArgs.cycles, // Array of cycles for this realm
                });
                log(`SUCCESS: Batch replenish with raw inputs in realm ${op.realmId}. Resources: ${op.rawReplenishArgs.types.map(id => ResourcesIds[id]).join(', ')}.`, 'success', op.realmId);
            } catch (e) {
                log(`ERROR: Batch replenish with raw inputs in realm ${op.realmId}: ${(e as Error).message}`, 'error', op.realmId);
            }
        }

        // Execute Labor Replenishment for this realm if args exist
        if (op.laborReplenishArgs && op.laborReplenishArgs.types.length > 0) {
            if (stopCycleRef.current) { log('Skipping labor replenishment for realm due to stop signal.', 'info', op.realmId); break; }
            try {
                log(`Batch replenishing ${op.laborReplenishArgs.types.length} resource types with Labor in realm ${op.realmId}.`, 'info', op.realmId);
                await systemCalls.burn_labor_for_resource_production({
                    signer: account,
                    from_entity_id: op.realmId, // Single realm ID
                    produced_resource_types: op.laborReplenishArgs.types, // Array of types for this realm
                    production_cycles: op.laborReplenishArgs.cycles, // Array of cycles for this realm
                });
                log(`SUCCESS: Batch replenish with Labor in realm ${op.realmId}. Resources: ${op.laborReplenishArgs.types.map(id => ResourcesIds[id]).join(', ')}.`, 'success', op.realmId);
            } catch (e) {
                log(`ERROR: Batch replenish with Labor in realm ${op.realmId}: ${(e as Error).message}`, 'error', op.realmId);
            }
        }
        log(`All operations executed for Realm ID: ${op.realmId}`, 'info', op.realmId);
      }
      // End of Phase 2 loop (per-realm execution)
      
    } catch (error) {
      log(`Error processing production cycle: ${(error as Error).message}`, 'error');
      setIsLoading(false);
    }
  }, [account, components, systemCalls, log, getMyOwnedRealms, productionIntervalMs, percentageForLaborInput, percentageInputForResources, percentageLaborForResources]);

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
      setIsRunning(savedIsRunning === 'true');
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
    localStorage.setItem(STORAGE_KEY_INTERVAL, productionIntervalMins.toString());
  }, [productionIntervalMins]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PERCENT_LABOR_INPUT, percentageForLaborInput.toString());
  }, [percentageForLaborInput]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PERCENT_INPUT_RESOURCES, percentageInputForResources.toString());
  }, [percentageInputForResources]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PERCENT_LABOR_RESOURCES, percentageLaborForResources.toString());
  }, [percentageLaborForResources]);
  
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (isRunning) {
      log('Auto-producer started.');
      processProductionCycle();
      intervalId = setInterval(processProductionCycle, productionIntervalMs);
    } else {
      // Only log "stopped" if it was previously running and is now not.
      if (prevIsRunningRef.current && !isRunning) {
        log('Auto-producer stopped.');
      }
    }

    // Update the ref to the current isRunning state for the next render cycle.
    // This runs after the main effect logic for the current render.
    prevIsRunningRef.current = isRunning;

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        // Avoid logging "interval cleared" if only settings changed while stopped.
        if (prevIsRunningRef.current) { // Only log if it was running before this effect instance
            log('Auto-producer interval cleared on unmount/stop.', 'info');
        }
      }
    };
  }, [isRunning, processProductionCycle, log, productionIntervalMs]);

  // Refined toggleRunning: purely for turning auto-scheduler on/off when no cycle is active.
  const toggleRunning = () => {
    setIsRunning((prevIsRunning: boolean) => {
      const newIsRunning = !prevIsRunning;
      if (newIsRunning) { // Starting auto-scheduler
        log('Auto-producer scheduling enabled.', 'info');
        stopCycleRef.current = false; // Ensure ready for new auto-runs
      } else { // Stopping auto-scheduler
        log('Auto-producer scheduling disabled.', 'info');
        // stopCycleRef is typically handled by the effect cleanup or manual stop, 
        // but can be set true if stopping scheduling explicitly without an active cycle stopping.
        // However, processProductionCycle will always reset it if it starts.
      }
      localStorage.setItem(STORAGE_KEY_IS_RUNNING, newIsRunning.toString());
      return newIsRunning;
    });
  };

  const handlePrimaryButtonClick = () => {
    if (isLoading) { // A cycle (manual or auto) is currently processing
        log('Stop signal sent to current active cycle.', 'info');
        stopCycleRef.current = true;
        if (isRunning) { // If it was an auto-cycle that was running, also turn off auto-scheduling
            setIsRunning(false); // This will also ensure interval is cleared via useEffect and state saved
        }
    } else { // No cycle is currently processing, so toggle the auto-scheduler
        toggleRunning();
    }
  };
  
  const handleSliderChange = (setter: React.Dispatch<React.SetStateAction<number>>, isPercentage: boolean) => (e: ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setter(isPercentage ? value / 100 : value);
  };

  const sliderStyle: React.CSSProperties = { width: '100%', marginBottom: '5px' };
  const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '2px', fontSize: '0.9em' };
  const valueStyle: React.CSSProperties = { fontSize: '0.9em', color: '#aaa', marginLeft: '10px' };

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

  const manualRunButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#007bff',
     opacity: isLoading ? 0.7 : 1,
  };


  return (
    <div style={{ fontFamily: 'monospace', padding: '10px', border: '1px solid #ccc', margin: '10px 0' }}>
      <h4>Automatic Resource Producer</h4>
      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
        This script runs automatically to produce Labor and other resources based on the settings below.
      </p>

      <div style={{ marginBottom: '15px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}>
        <label style={labelStyle}>
          Production Interval: 
          <span style={valueStyle}>{productionIntervalMins} min(s)</span>
        </label>
        <input 
          type="range" 
          min="1" 
          max="60" 
          step="1"
          value={productionIntervalMins} 
          onChange={handleSliderChange(setProductionIntervalMins, false)}
          style={sliderStyle}
          disabled={isRunning}
        />

        <label style={labelStyle}>
          % of Input Resources for Labor Prod:
          <span style={valueStyle}>{(percentageForLaborInput * 100).toFixed(0)}%</span>
        </label>
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
          value={percentageForLaborInput * 100} 
          onChange={handleSliderChange(setPercentageForLaborInput, true)}
          style={sliderStyle}
          disabled={isRunning}
        />

        <label style={labelStyle}>
          % of Raw Inputs for Resource Prod:
          <span style={valueStyle}>{(percentageInputForResources * 100).toFixed(0)}%</span>
        </label>
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
          value={percentageInputForResources * 100} 
          onChange={handleSliderChange(setPercentageInputForResources, true)}
          style={sliderStyle}
          disabled={isRunning}
        />

        <label style={labelStyle}>
          % of Labor for Resource Prod:
          <span style={valueStyle}>{(percentageLaborForResources * 100).toFixed(0)}%</span>
        </label>
        <input 
          type="range" 
          min="0" 
          max="100" 
          step="1"
          value={percentageLaborForResources * 100} 
          onChange={handleSliderChange(setPercentageLaborForResources, true)}
          style={sliderStyle}
          disabled={isRunning}
        />
      </div>

      <button 
        style={isLoading 
            ? { ...buttonStyle, backgroundColor: '#ffc107', color: 'black' } 
            : { ...buttonStyle, backgroundColor: isRunning ? '#dc3545' : '#28a745' }}
        onClick={handlePrimaryButtonClick} 
        disabled={!account?.address} // Only disabled if no account
      >
        {isLoading 
            ? 'Stop Current Cycle' 
            : isRunning 
                ? 'Stop Auto-Producer' 
                : 'Start Auto-Producer'}
      </button>
      <button
        style={manualRunButtonStyle}
        onClick={processProductionCycle}
        disabled={isLoading || !account?.address}
      >
        {isLoading ? 'Processing...' : 'Run Production Cycle Now'}
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