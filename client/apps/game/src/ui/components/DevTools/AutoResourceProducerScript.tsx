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
import React, { ChangeEvent, useCallback, useEffect, useState } from 'react';

const LABOR_RESOURCE_ID = ResourcesIds.Labor;

// Default values for sliders
const DEFAULT_PRODUCTION_INTERVAL_MIN = 5; // minutes
const DEFAULT_PERCENTAGE_FOR_LABOR_INPUT = 0.5; 
const DEFAULT_PERCENTAGE_INPUT_FOR_RESOURCES = 0.5; 
const DEFAULT_PERCENTAGE_LABOR_FOR_RESOURCES = 0.25; 

interface LogEntry {
  timestamp: Date;
  message: string;
  realmId?: ID;
  type: 'info' | 'error' | 'success';
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
  const [productionIntervalMins, setProductionIntervalMins] = useState<number>(DEFAULT_PRODUCTION_INTERVAL_MIN);
  const [percentageForLaborInput, setPercentageForLaborInput] = useState<number>(DEFAULT_PERCENTAGE_FOR_LABOR_INPUT);
  const [percentageInputForResources, setPercentageInputForResources] = useState<number>(DEFAULT_PERCENTAGE_INPUT_FOR_RESOURCES);
  const [percentageLaborForResources, setPercentageLaborForResources] = useState<number>(DEFAULT_PERCENTAGE_LABOR_FOR_RESOURCES);

  const productionIntervalMs = productionIntervalMins * 60 * 1000;

  const log = useCallback((message: string, type: LogEntry['type'] = 'info', realmId?: ID) => {
    console.log(`[AutoProducer] ${realmId ? `(Realm ${realmId}) ` : ''}${message}`);
    setLogs((prevLogs: LogEntry[]) => [{ timestamp: new Date(), message, realmId, type }, ...prevLogs].slice(0, 100));
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
    log('Starting auto production cycle with current settings...');

    const ownedRealms = await getMyOwnedRealms();
    if (ownedRealms.length === 0) {
      log('No owned realms found.');
      setIsLoading(false);
      return;
    }

    const { currentDefaultTick } = getBlockTimestamp();

    for (const realm of ownedRealms) {
      const realmId = realm.entityId;
      log(`Processing Realm ID: ${realmId}`, 'info', realmId);

      try {
        log(`Attempting to produce Labor from various resources using ${percentageForLaborInput * 100}%.`, 'info', realmId);
        const allResourceIds = Object.values(ResourcesIds).filter(
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

        for (const resourceToBurnId of allResourceIds) {
            const laborProductionConfig = configManager.getLaborConfig(resourceToBurnId);
            
            if (laborProductionConfig && laborProductionConfig.laborProductionPerResource > 0) {
                const resourceBalance = getBalance(realmId, resourceToBurnId, currentDefaultTick, components).balance;
                const resourceToBurnNat = divideByPrecision(resourceBalance) * percentageForLaborInput;

                if (resourceToBurnNat > 0) {
                    try {
                        log(`Attempting to burn ${resourceToBurnNat.toFixed(2)} of ${ResourcesIds[resourceToBurnId]} (ID: ${resourceToBurnId}) for Labor.`, 'info', realmId);
                        await systemCalls.burn_resource_for_labor_production({
                            signer: account,
                            entity_id: realmId,
                            resource_types: [resourceToBurnId],
                            resource_amounts: [multiplyByPrecision(resourceToBurnNat)],
                        });
                        log(`Successfully initiated burning ${resourceToBurnNat.toFixed(2)} of ${ResourcesIds[resourceToBurnId]} for Labor.`, 'success', realmId);
                    } catch (e) {
                        log(`Error burning ${ResourcesIds[resourceToBurnId]} for Labor: ${(e as Error).message}`, 'error', realmId);
                    }
                }
            } else {
                // Optional: log if a resource is not configured for labor production
                // log(`Resource ${ResourcesIds[resourceToBurnId]} (ID: ${resourceToBurnId}) is not configured for labor production or has no output.`, 'info', realmId);
            }
        }

        const laborBalanceFull = getBalance(realmId, LABOR_RESOURCE_ID, currentDefaultTick, components).balance;
        const availableLaborNat = divideByPrecision(laborBalanceFull);
        log(`Available Labor: ${availableLaborNat.toFixed(2)}. Using ${percentageLaborForResources * 100}% for resource production.`, 'info', realmId);

        const producibleResources = Object.keys(configManager.complexSystemResourceInputs)
          .map(Number)
          .filter(id => id !== LABOR_RESOURCE_ID && !isNaN(id)); // Ensure it's a number and not Labor itself
        
        log(`Found ${producibleResources.length} producible resource types. Evaluating with ${percentageInputForResources * 100}% input usage.`, 'info', realmId);

        for (const resourceIdToProduce of producibleResources) {
          log(`Evaluating production for Resource ID: ${resourceIdToProduce}`, 'info', realmId);
          let producedThisResource = false;

          const inputs = configManager.complexSystemResourceInputs[resourceIdToProduce];
          if (inputs && inputs.length > 0) {
            let minCyclesAffordableByInputs = Infinity;
            let canAffordAllInputs = true;

            for (const input of inputs) {
              const inputBalance = getBalance(realmId, input.resource, currentDefaultTick, components).balance;
              const availableInputForProdNat = divideByPrecision(inputBalance) * percentageInputForResources;
              const cyclesForThisInput = Math.floor(availableInputForProdNat / input.amount);
              
              if (cyclesForThisInput === 0) {
                canAffordAllInputs = false;
                break;
              }
              minCyclesAffordableByInputs = Math.min(minCyclesAffordableByInputs, cyclesForThisInput);
            }

            if (canAffordAllInputs && minCyclesAffordableByInputs > 0 && minCyclesAffordableByInputs !== Infinity) {
              try {
                log(`Attempting to produce Resource ${resourceIdToProduce} using raw inputs for ${minCyclesAffordableByInputs} cycles.`, 'info', realmId);
                await systemCalls.burn_resource_for_resource_production({
                  signer: account,
                  from_entity_id: realmId,
                  produced_resource_types: [resourceIdToProduce],
                  production_cycles: [minCyclesAffordableByInputs],
                });
                log(`Successfully initiated production of Resource ${resourceIdToProduce} for ${minCyclesAffordableByInputs} cycles using raw inputs.`, 'success', realmId);
                producedThisResource = true;
              } catch (e) {
                log(`Error producing Resource ${resourceIdToProduce} with raw inputs: ${(e as Error).message}`, 'error', realmId);
              }
            } else {
               log(`Cannot afford raw inputs for Resource ${resourceIdToProduce} or no cycles possible.`, 'info', realmId);
            }
          }

          if (!producedThisResource) {
            const laborConfig = configManager.getLaborConfig(resourceIdToProduce);
            if (laborConfig && laborConfig.inputResources.length > 0 && laborConfig.laborBurnPerResourceOutput > 0) {
               // Assuming the primary labor input is the first one, or specifically Labor.
               // This logic needs to be robust if multiple inputs are involved in labor-based production.
               // For simplicity, let's assume laborConfig.laborBurnPerResourceOutput is the key.
               // And resourceOutputPerInputResources is how much is produced per "labor cycle".

              const laborToSpendForResourceNat = availableLaborNat * percentageLaborForResources;
              const outputPerCycleNat = laborConfig.resourceOutputPerInputResources; // Amount of target resource per cycle
              const laborCostPerUnitNat = laborConfig.laborBurnPerResourceOutput; // Labor cost per unit of target resource
              
              if (outputPerCycleNat > 0 && laborCostPerUnitNat > 0) {
                const laborCostPerCycleNat = laborCostPerUnitNat * outputPerCycleNat;
                const maxCyclesAffordableWithLabor = Math.floor(laborToSpendForResourceNat / laborCostPerCycleNat);

                if (maxCyclesAffordableWithLabor > 0) {
                  try {
                    log(`Attempting to produce Resource ${resourceIdToProduce} using Labor for ${maxCyclesAffordableWithLabor} cycles.`, 'info', realmId);
                    await systemCalls.burn_labor_for_resource_production({
                      signer: account,
                      from_entity_id: realmId,
                      produced_resource_types: [resourceIdToProduce],
                      production_cycles: [maxCyclesAffordableWithLabor],
                    });
                    log(`Successfully initiated production of Resource ${resourceIdToProduce} for ${maxCyclesAffordableWithLabor} cycles using Labor.`, 'success', realmId);
                  } catch (e) {
                    log(`Error producing Resource ${resourceIdToProduce} with Labor: ${(e as Error).message}`, 'error', realmId);
                  }
                } else {
                  log(`Not enough Labor or zero cycles possible for Resource ${resourceIdToProduce}. Labor to spend: ${laborToSpendForResourceNat.toFixed(2)}, Cost per cycle: ${laborCostPerCycleNat.toFixed(2)}`, 'info', realmId);
                }
              } else {
                 log(`Labor production config issue for Resource ${resourceIdToProduce} (output: ${outputPerCycleNat}, cost: ${laborCostPerUnitNat})`, 'info', realmId);
              }
            } else {
              log(`No suitable Labor production config found for Resource ID: ${resourceIdToProduce}`, 'info', realmId);
            }
          }
        }
      } catch (realmError) {
        log(`Unhandled error processing realm ${realmId}: ${(realmError as Error).message}`, 'error', realmId);
      }
    }

    log('Auto production cycle finished.');
    setIsLoading(false);
  }, [account, components, systemCalls, log, getMyOwnedRealms, productionIntervalMs, percentageForLaborInput, percentageInputForResources, percentageLaborForResources]);

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
    setIsRunning((prev: boolean) => !prev);
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

      <button style={buttonStyle} onClick={toggleRunning} disabled={isLoading && isRunning}>
        {isRunning ? (isLoading ? 'Processing...' : 'Stop Auto-Producer') : 'Start Auto-Producer'}
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