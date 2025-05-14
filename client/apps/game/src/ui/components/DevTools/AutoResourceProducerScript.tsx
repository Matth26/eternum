import { getBlockTimestamp } from '@/utils/timestamp';
import {
  configManager,
  divideByPrecision,
  getBalance,
  multiplyByPrecision,
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
      const ownedRealms = await getMyOwnedRealms();
      if (stopCycleRef.current) {
        log('Production cycle stopped by user before processing realms.', 'info');
        return;
      }
      if (ownedRealms.length === 0) {
        log('No owned realms found.');
        return;
      }

      const { currentDefaultTick } = getBlockTimestamp();

      for (const realm of ownedRealms) {
        if (stopCycleRef.current) {
          log('Production cycle stopped by user during realm iteration.', 'info', realm.entityId);
          break; // Exit realm loop
        }
        const realmId = realm.entityId;
        log(`Processing Realm ID: ${realmId}`, 'info', realmId);
        const burnedForLaborList: ResourcesIds[] = []; // Track resources burned for labor in this realm

        try {
          // Part 1: Produce Labor by burning specified resources
          log(`Phase 1: Producing Labor from raw resources using ${percentageForLaborInput * 100}%.`, 'info', realmId);
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

          for (const resourceToBurnId of resourcesToConsiderForLaborBurn) {
              if (stopCycleRef.current) {
                log('Production cycle stopped by user during labor production phase.', 'info', realmId);
                break; // Exit resource burn loop
              }
              const laborProductionConfig = configManager.getLaborConfig(resourceToBurnId);
              
              if (laborProductionConfig && laborProductionConfig.laborProductionPerResource > 0) {
                  const resourceBalance = getBalance(realmId, resourceToBurnId, currentDefaultTick, components).balance;
                  const resourceToBurnNat = Math.floor(divideByPrecision(resourceBalance) * percentageForLaborInput);

                  if (resourceToBurnNat > 0) {
                      try {
                          log(`Attempting to burn ${resourceToBurnNat.toFixed(2)} of ${ResourcesIds[resourceToBurnId]} (ID: ${resourceToBurnId}) for Labor.`, 'info', realmId);
                          if (stopCycleRef.current) { log('Cycle stopped before burning resource for labor.','info', realmId); break;}
                          await systemCalls.burn_resource_for_labor_production({
                              signer: account,
                              entity_id: realmId,
                              resource_types: [resourceToBurnId],
                              resource_amounts: [multiplyByPrecision(resourceToBurnNat)],
                          });
                          log(`Successfully initiated burning ${resourceToBurnNat.toFixed(2)} of ${ResourcesIds[resourceToBurnId]} for Labor.`, 'success', realmId);
                          if (!burnedForLaborList.includes(resourceToBurnId)) {
                              burnedForLaborList.push(resourceToBurnId);
                          }
                      } catch (e) {
                          log(`Error burning ${ResourcesIds[resourceToBurnId]} for Labor: ${(e as Error).message}`, 'error', realmId);
                      }
                  }
              }
          }
          log(`Phase 1 (Labor Production) complete for realm ${realmId}. Burned ${burnedForLaborList.length} resource types for labor.`, 'info', realmId);

          // Part 2: Replenish resources that were burned for Labor
          if (burnedForLaborList.length > 0) {
              if (stopCycleRef.current) {
                  log('Production cycle stopped by user before replenishment phase.', 'info', realmId);
                  break; // Exit from realm processing if stop is requested
              }
              log(`Phase 2: Attempting to replenish ${burnedForLaborList.length} resource types that were burned for Labor.`, 'info', realmId);
              const laborBalanceFull = getBalance(realmId, LABOR_RESOURCE_ID, currentDefaultTick, components).balance;
              const availableLaborNat = divideByPrecision(laborBalanceFull);
              log(`Current available Labor for replenishment: ${availableLaborNat.toFixed(2)} (Using ${percentageLaborForResources * 100}% of this if needed).`, 'info', realmId);

              for (const resourceIdToReplenish of burnedForLaborList) {
                  if (stopCycleRef.current) {
                      log('Production cycle stopped by user during resource replenishment iteration.', 'info', realmId);
                      break; // Exit replenishment loop
                  }
                  log(`Evaluating replenishment for ${ResourcesIds[resourceIdToReplenish]} (ID: ${resourceIdToReplenish})`, 'info', realmId);
                  let replenishedThisResource = false;

                  // Attempt 1: Replenish with raw input resources
                  log(`Attempting to replenish ${ResourcesIds[resourceIdToReplenish]} using raw inputs (${percentageInputForResources * 100}% of available).`, 'info', realmId);
                  const inputs = configManager.complexSystemResourceInputs[resourceIdToReplenish];
                  if (inputs && inputs.length > 0) {
                      let minCyclesAffordableByInputs = Infinity;
                      let canAffordAllInputs = true;

                      for (const input of inputs) {
                          const inputBalance = getBalance(realmId, input.resource, currentDefaultTick, components).balance;
                          const availableInputForProdNat = Math.floor(divideByPrecision(inputBalance) * percentageInputForResources);
                          const cyclesForThisInput = Math.floor(availableInputForProdNat / input.amount);
                          
                          if (cyclesForThisInput === 0) {
                              log(`Cannot afford input ${ResourcesIds[input.resource]} for ${ResourcesIds[resourceIdToReplenish]}. Needed per cycle: ${input.amount}, Available for prod: ${availableInputForProdNat.toFixed(2)}`, 'info', realmId);
                              canAffordAllInputs = false;
                              break;
                          }
                          minCyclesAffordableByInputs = Math.min(minCyclesAffordableByInputs, cyclesForThisInput);
                      }

                      if (canAffordAllInputs && minCyclesAffordableByInputs > 0 && minCyclesAffordableByInputs !== Infinity) {
                          try {
                              log(`Replenishing ${ResourcesIds[resourceIdToReplenish]} using raw inputs for ${minCyclesAffordableByInputs} cycles.`, 'info', realmId);
                              if (stopCycleRef.current) { log('Cycle stopped before replenishing with raw inputs.','info', realmId); break;}
                              await systemCalls.burn_resource_for_resource_production({
                                  signer: account,
                                  from_entity_id: realmId,
                                  produced_resource_types: [resourceIdToReplenish],
                                  production_cycles: [minCyclesAffordableByInputs],
                              });
                              log(`Successfully initiated replenishment of ${ResourcesIds[resourceIdToReplenish]} for ${minCyclesAffordableByInputs} cycles using raw inputs.`, 'success', realmId);
                              replenishedThisResource = true;
                          } catch (e) {
                              log(`Error replenishing ${ResourcesIds[resourceIdToReplenish]} with raw inputs: ${(e as Error).message}`, 'error', realmId);
                          }
                      } else {
                          log(`Cannot afford all raw inputs for ${ResourcesIds[resourceIdToReplenish]} or no cycles possible for replenishment.`, 'info', realmId);
                      }
                  } else {
                      log(`No complex input recipe found for ${ResourcesIds[resourceIdToReplenish]}.`, 'info', realmId);
                  }

                  // Attempt 2: Replenish with Labor (if not already replenished with raw inputs)
                  if (!replenishedThisResource) {
                      log(`Attempting to replenish ${ResourcesIds[resourceIdToReplenish]} using Labor.`, 'info', realmId);
                      const laborConfigForReplenish = configManager.getLaborConfig(resourceIdToReplenish);
                      if (laborConfigForReplenish && laborConfigForReplenish.inputResources.length > 0 && laborConfigForReplenish.laborBurnPerResourceOutput >= 0) { // Allow 0 labor burn if other simple inputs exist
                          // Check if this resource *can* be produced by simple inputs (which typically includes labor)
                          if (laborConfigForReplenish.resourceOutputPerInputResources > 0) {
                              const laborToSpendForResourceNat = Math.floor(availableLaborNat * percentageLaborForResources);
                              const outputPerCycleNat = laborConfigForReplenish.resourceOutputPerInputResources;
                              
                              // Calculate actual labor cost per cycle from inputResources list
                              let actualLaborCostPerCycleNat = 0;
                              let hasLaborInput = false;
                              for(const inputResource of laborConfigForReplenish.inputResources) {
                                  if (inputResource.resource === LABOR_RESOURCE_ID) {
                                      actualLaborCostPerCycleNat = inputResource.amount; // Assumes amount is in natural units
                                      hasLaborInput = true;
                                      break;
                                  }
                              }

                              // If recipe doesn't directly require labor but is simple, we might not proceed, or assume 0 labor cost if appropriate.
                              // For now, we proceed if there's a labor input defined or if laborBurnPerResourceOutput is explicit (though direct input is better)
                              // The field `laborBurnPerResourceOutput` might be an aggregate or average, best to use specific input costs if available.
                              // We will prioritize direct labor input if specified in `inputResources`.

                              if (hasLaborInput || laborConfigForReplenish.laborBurnPerResourceOutput > 0) {
                                  // If direct labor input not found, fall back to laborBurnPerResourceOutput (less precise)
                                  if (!hasLaborInput && laborConfigForReplenish.laborBurnPerResourceOutput > 0) {
                                       actualLaborCostPerCycleNat = laborConfigForReplenish.laborBurnPerResourceOutput * outputPerCycleNat;
                                       log(`Using calculated labor cost per cycle for ${ResourcesIds[resourceIdToReplenish]}: ${actualLaborCostPerCycleNat.toFixed(2)}`, 'info', realmId);
                                  }

                                  if (actualLaborCostPerCycleNat === 0 && !hasLaborInput) {
                                       log(`Resource ${ResourcesIds[resourceIdToReplenish]} has a simple recipe but does not explicitly consume Labor. Skipping labor-based replenishment unless other simple inputs are handled.`, 'info', realmId);
                                  } else {
                                      const maxCyclesAffordableWithLabor = actualLaborCostPerCycleNat > 0 
                                          ? Math.floor(laborToSpendForResourceNat / actualLaborCostPerCycleNat)
                                          : (laborToSpendForResourceNat > 0 ? Infinity : 0); // If labor cost is 0, can do infinite cycles if any labor is to be spent (conceptually)

                                      if (maxCyclesAffordableWithLabor > 0 && maxCyclesAffordableWithLabor !== Infinity) {
                                          try {
                                              log(`Replenishing ${ResourcesIds[resourceIdToReplenish]} using Labor for ${maxCyclesAffordableWithLabor} cycles. Labor to spend: ${laborToSpendForResourceNat.toFixed(2)}, Cost/cycle: ${actualLaborCostPerCycleNat.toFixed(2)}`, 'info', realmId);
                                              if (stopCycleRef.current) { log('Cycle stopped before replenishing with labor.','info', realmId); break;}
                                              await systemCalls.burn_labor_for_resource_production({
                                                  signer: account,
                                                  from_entity_id: realmId,
                                                  produced_resource_types: [resourceIdToReplenish],
                                                  production_cycles: [maxCyclesAffordableWithLabor],
                                              });
                                              log(`Successfully initiated replenishment of ${ResourcesIds[resourceIdToReplenish]} for ${maxCyclesAffordableWithLabor} cycles using Labor.`, 'success', realmId);
                                          } catch (e) {
                                              log(`Error replenishing ${ResourcesIds[resourceIdToReplenish]} with Labor: ${(e as Error).message}`, 'error', realmId);
                                          }
                                      } else if (maxCyclesAffordableWithLabor === Infinity && laborConfigForReplenish.inputResources.every(inp => inp.resource !== LABOR_RESOURCE_ID)) {
                                          log(`Resource ${ResourcesIds[resourceIdToReplenish]} simple recipe has no direct labor cost, but other simple inputs may be required. This path needs review if those inputs aren't covered.`, 'info', realmId);
                                      } else {
                                          log(`Not enough Labor or zero cycles for replenishment of ${ResourcesIds[resourceIdToReplenish]} with Labor. Labor to spend: ${laborToSpendForResourceNat.toFixed(2)}, Cost/cycle: ${actualLaborCostPerCycleNat.toFixed(2)}`, 'info', realmId);
                                      }
                                  }
                              } else {
                                  log(`Resource ${ResourcesIds[resourceIdToReplenish]} does not have a primary Labor consumption pathway in its simple recipe according to inputResources and laborBurnPerResourceOutput.`, 'info', realmId);
                              }
                          } else {
                              log(`Simple production recipe for ${ResourcesIds[resourceIdToReplenish]} has zero output per cycle. Cannot replenish with labor.`, 'info', realmId);
                          }
                      } else {
                          log(`No suitable simple (Labor-based) production config found for replenishment of Resource ID: ${resourceIdToReplenish}`, 'info', realmId);
                      }
                  }
              }
          } else {
              log('Phase 2: No resources were burned for Labor in this cycle, so no specific replenishment attempted.', 'info', realmId);
          }

        } catch (realmError) {
          log(`Unhandled error processing realm ${realmId}: ${(realmError as Error).message}`, 'error', realmId);
        }
      }

      log('Auto production cycle finished or stopped.');
      setIsLoading(false);
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
      log('Auto-producer stopped.');
      if (intervalId) {
        clearInterval(intervalId);
      }
    }
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        log('Auto-producer interval cleared on unmount/stop.');
      }
    };
  }, [isRunning, processProductionCycle, log, productionIntervalMs]);

  const toggleRunning = () => {
    setIsRunning((prevIsRunning: boolean) => {
      const newIsRunning = !prevIsRunning;
      if (!newIsRunning) { // If stopping
        stopCycleRef.current = true; // Signal current cycle to stop
        log('Stop signal sent to current production cycle.', 'info');
      }
      localStorage.setItem(STORAGE_KEY_IS_RUNNING, newIsRunning.toString());
      return newIsRunning;
    });
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
    backgroundColor: isRunning ? '#dc3545' : '#28a745', 
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
        style={buttonStyle} 
        onClick={toggleRunning} 
        disabled={!isRunning && isLoading}
      >
        {isRunning ? 'Stop Auto-Producer' : 'Start Auto-Producer'}
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