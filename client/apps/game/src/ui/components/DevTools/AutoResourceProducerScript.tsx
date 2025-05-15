import { configManager, divideByPrecision, getRealmInfo, multiplyByPrecision } from "@bibliothecadao/eternum";
import { useDojo } from "@bibliothecadao/react";
import { ClientComponents, RESOURCE_PRECISION, resources as resourceList } from "@bibliothecadao/types";
import { getComponentValue, Has, runQuery } from "@dojoengine/recs";
import React, { useCallback, useEffect, useState } from "react";

interface AutoResourceProducerScriptProps {
  log: (message: string, type?: 'info' | 'error' | 'success', script?: string) => void;
}

export const AutoResourceProducerScript: React.FC<AutoResourceProducerScriptProps> = ({ log }) => {
  const {
    setup: { components, systemCalls },
    account: { account },
  } = useDojo();

  const [isLoading, setIsLoading] = useState(false);
  const [jsonDataOutput, setJsonDataOutput] = useState<string>("");

  // Persist JSON to localStorage
  useEffect(() => {
    const saved = localStorage.getItem("autoResourceProducerJson");
    if (saved) setJsonDataOutput(saved);
  }, []);

  useEffect(() => {
    if (jsonDataOutput) {
      localStorage.setItem("autoResourceProducerJson", jsonDataOutput);
    } else {
      localStorage.removeItem("autoResourceProducerJson");
    }
  }, [jsonDataOutput]);

  // Helper: build output with explicit % fields for each action
  const buildOutputWithPercentages = (allRealmsInfo: any[]) => {
    return allRealmsInfo.map((realm) => ({
      entityId: realm.entityId,
      name: realm.name,
      resources: realm.resources.map((res: any) => ({
        name: res.name,
        amount: res.amount,
        percentForLaborProd: 0, // percent to burn for producing labor
        percentOfRawForProd: 0, // percent to use for standard resource production
        percentOfLaborForProd: 0, // percent to use for labor-for-resource production
      })),
    }));
  };

  const handleFetchAllRealmsResources = useCallback(async () => {
    setIsLoading(true);
    setJsonDataOutput("");
    log("Querying all realms and their resources...", 'info', 'AutoResourceProducer');
    try {
      if (!components) {
        setJsonDataOutput("Error: Dojo components not available.");
        log("Error: Dojo components not available.", 'error', 'AutoResourceProducer');
        setIsLoading(false);
        return;
      }
      const structureEntities = runQuery([Has(components.Structure)]);
      const output = Array.from(structureEntities)
        .map((entityId) => {
          const structure = getComponentValue(components.Structure, entityId);
          if (
            structure &&
            Number(structure.category) === 1 &&
            structure.owner &&
            ("0x" + structure.owner.toString(16)).toLowerCase() === account.address.toLowerCase()
          ) {
            const realmInfo = getRealmInfo(entityId, components as ClientComponents);
            const resourceComponent = getComponentValue(components.Resource, entityId);
            if (!realmInfo || !resourceComponent) return undefined;
            const resources = resourceList
              .map((res: { trait: string }) => {
                const key = `${res.trait.toUpperCase().replace(/ /g, '_')}_BALANCE` as keyof typeof resourceComponent;
                const balance = resourceComponent[key] as bigint | undefined;
                if (
                  typeof balance === 'bigint' &&
                  balance > 0n &&
                  res.trait !== 'Wheat' &&
                  res.trait !== 'Fish' &&
                  res.trait !== 'Labor' &&
                  res.trait !== 'Lords'
                ) {
                  // Use divideByPrecision for display only
                  return { name: res.trait, amount: divideByPrecision(Number(balance)) };
                }
                return undefined;
              })
              .filter(Boolean);
            return {
              entityId: structure.entity_id,
              structure,
              name: realmInfo.name,
              resources,
            };
          }
          return undefined;
        })
        .filter(Boolean);
      if (output.length === 0) {
        log("No realms found.", 'info', 'AutoResourceProducer');
      } else {
        log(`Successfully fetched ${output.length} realms.`, 'success', 'AutoResourceProducer');
      }
      // Add % fields for each action
      setJsonDataOutput(JSON.stringify(buildOutputWithPercentages(output), null, 2));
    } catch (error) {
      setJsonDataOutput(`Error: ${(error as Error).message}`);
      log(`Error fetching realms/resources: ${(error as Error).message}`, 'error', 'AutoResourceProducer');
    } finally {
      setIsLoading(false);
    }
  }, [components, log, account]);

  // Handler for batch production
  const handleBatchProduce = useCallback(async () => {
    if (!systemCalls) {
      log("System calls not available.", 'error', 'AutoResourceProducer');
      return;
    }
    setIsLoading(true);
    try {
      log("[BatchProduce] Parsing JSON data...", 'info', 'AutoResourceProducer');
      const parsed = JSON.parse(jsonDataOutput);
      log(`[BatchProduce] Parsed ${parsed.length} realms from JSON.`, 'info', 'AutoResourceProducer');
      let totalSteps = 0;
      for (const realm of parsed) {
        const resources = realm.resources;
        if (resources.some((r: any) => r.percentForLaborProd > 0)) totalSteps++;
        if (resources.some((r: any) => r.percentOfRawForProd > 0)) totalSteps++;
        if (resources.some((r: any) => r.percentOfLaborForProd > 0)) totalSteps++;
      }
      log(`[BatchProduce] Total steps to process: ${totalSteps}`, 'info', 'AutoResourceProducer');
      let currentStep = 1;
      for (const realm of parsed) {
        const entityId = typeof realm.entityId === "string" ? Number(realm.entityId) : realm.entityId;
        const resources = realm.resources;
        log(`[BatchProduce] Processing realm entityId: ${entityId} (step ${currentStep} of ${totalSteps})`, 'info', 'AutoResourceProducer');
        // Batch for labor production
        const laborResources = resources
          .map((resource: any) => {
            const resourceObj = resourceList.find((r: any) => r.trait === resource.name);
            if (!resourceObj) return null;
            const resourceId = resourceObj.id;
            // Use multiplyByPrecision for contract calls
            const available = multiplyByPrecision(resource.amount);
            let amountToBurn = Math.floor((available * resource.percentForLaborProd) / 100);
            amountToBurn = amountToBurn - (amountToBurn % RESOURCE_PRECISION);
            if (amountToBurn > available) {
              log(`[WARN] Requested burn amount (${amountToBurn}) exceeds available balance (${available}) for resourceId ${resourceId}. Adjusting to available.`, 'info', 'AutoResourceProducer');
              amountToBurn = available;
            }
            const amount = Number(amountToBurn);
            return resource.percentForLaborProd > 0 && amount > 0 ? { resourceId, amount } : null;
          })
          .filter(Boolean);
        // Log divisibility check
        laborResources.forEach((r: any) => {
          if (r.amount % RESOURCE_PRECISION !== 0) {
            log(`[ERROR] Resource amount for resourceId ${r.resourceId} is not divisible by RESOURCE_PRECISION: ${r.amount}`, 'error', 'AutoResourceProducer');
          } else {
            log(`[CHECK] Resource amount for resourceId ${r.resourceId} is OK: ${r.amount}`, 'info', 'AutoResourceProducer');
          }
        });
        log(`[BatchProduce] Labor resources for realm ${entityId}: ${JSON.stringify(laborResources)}`, 'info', 'AutoResourceProducer');
        if (laborResources.length > 0 && systemCalls.burn_resource_for_labor_production) {
          log(`[Step ${currentStep} of ${totalSteps}] Preparing to burn resources for labor in realm ${entityId}. Payload: ${JSON.stringify({ entity_id: entityId, resource_types: laborResources.map((r: any) => r.resourceId), resource_amounts: laborResources.map((r: any) => r.amount) })}`, 'info', 'AutoResourceProducer');
          try {
            log(`[Step ${currentStep} of ${totalSteps}] Calling burn_resource_for_labor_production...`, 'info', 'AutoResourceProducer');
            await systemCalls.burn_resource_for_labor_production({
              entity_id: entityId,
              resource_types: laborResources.map((r: any) => r.resourceId),
              resource_amounts: laborResources.map((r: any) => r.amount),
              signer: account,
            });
            log(`[Step ${currentStep} of ${totalSteps}] Burned resources for labor in realm ${entityId}.`, 'success', 'AutoResourceProducer');
          } catch (e) {
            log(`[Step ${currentStep} of ${totalSteps}] ERROR during burn_resource_for_labor_production for realm ${entityId}: ${(e as Error).message}`, 'error', 'AutoResourceProducer');
            throw e;
          }
          currentStep++;
        }
        // Batch for raw resource production
        const rawResources = resources
          .map((resource: any) => {
            const resourceObj = resourceList.find((r: any) => r.trait === resource.name);
            if (!resourceObj) return null;
            const resourceId = resourceObj.id;
            if (!(resource.percentOfRawForProd > 0)) return null;
            // Calculate cycles based on all required inputs
            const laborConfig = configManager.getLaborConfig(resourceId);
            if (!laborConfig || !laborConfig.inputResources || laborConfig.inputResources.length === 0) return null;
            let minCycles = Infinity;
            let canAfford = true;
            for (const input of laborConfig.inputResources) {
              // Find the input resource in the realm's resources array (from JSON)
              const inputRes = resources.find((r: any) => {
                const inputObj = resourceList.find((rr: any) => rr.trait === r.name);
                return inputObj && inputObj.id === input.resource;
              });
              if (!inputRes) {
                log(`[SKIP] Raw prod: Input resource ${input.resource} not found for ${resource.name} in realm ${entityId}.`, 'info', 'AutoResourceProducer');
                canAfford = false;
                break;
              }
              // Use the available amount (already in decimal precision)
              const available = inputRes.amount * (resource.percentOfRawForProd / 100);
              const cycles = Math.floor(available / input.amount);
              if (cycles === 0) {
                log(`[SKIP] Raw prod: Not enough of input ${input.resource} for ${resource.name} in realm ${entityId}.`, 'info', 'AutoResourceProducer');
                canAfford = false;
                break;
              }
              minCycles = Math.min(minCycles, cycles);
            }
            if (!canAfford || minCycles <= 0 || minCycles === Infinity) return null;
            // Floor cycles to integer
            const flooredCycles = Math.floor(minCycles);
            if (flooredCycles !== minCycles) {
              log(`[ADJUST] Raw prod: Cycles for ${resource.name} in realm ${entityId} adjusted from ${minCycles} to ${flooredCycles} for precision.`, 'info', 'AutoResourceProducer');
            }
            return { resourceId, amount: flooredCycles };
          })
          .filter(Boolean);
        log(`[BatchProduce] Raw resources for realm ${entityId}: ${JSON.stringify(rawResources)}`, 'info', 'AutoResourceProducer');
        if (rawResources.length > 0 && systemCalls.burn_resource_for_resource_production) {
          log(`[Step ${currentStep} of ${totalSteps}] Preparing to burn resources for raw production in realm ${entityId}. Payload: ${JSON.stringify({ from_entity_id: entityId, produced_resource_types: rawResources.map((r: any) => r.resourceId), production_cycles: rawResources.map((r: any) => r.amount) })}`, 'info', 'AutoResourceProducer');
          try {
            log(`[Step ${currentStep} of ${totalSteps}] Calling burn_resource_for_resource_production...`, 'info', 'AutoResourceProducer');
            await systemCalls.burn_resource_for_resource_production({
              from_entity_id: entityId,
              produced_resource_types: rawResources.map((r: any) => r.resourceId),
              production_cycles: rawResources.map((r: any) => r.amount),
              signer: account,
            });
            log(`[Step ${currentStep} of ${totalSteps}] Burned resources for raw production in realm ${entityId}.`, 'success', 'AutoResourceProducer');
          } catch (e) {
            log(`[Step ${currentStep} of ${totalSteps}] ERROR during burn_resource_for_resource_production for realm ${entityId}: ${(e as Error).message}`, 'error', 'AutoResourceProducer');
            throw e;
          }
          currentStep++;
        }
        // Batch for labor-for-resource production
        const laborForResourceResources = resources
          .map((resource: any) => {
            const resourceObj = resourceList.find((r: any) => r.trait === resource.name);
            if (!resourceObj) return null;
            const resourceId = resourceObj.id;
            if (!(resource.percentOfLaborForProd > 0)) return null;
            // Calculate cycles based on available labor and per-cycle labor cost
            const laborConfig = configManager.getLaborConfig(resourceId);
            if (!laborConfig || !laborConfig.inputResources || laborConfig.inputResources.length === 0) return null;
            // Find labor input
            const laborInput = laborConfig?.inputResources?.find((input: any) => input.resource === resourceList.find((r: any) => r.trait === 'Labor')?.id);
            if (!laborInput || laborInput.amount <= 0) return null;
            // Find labor resource in realm's resources array (from JSON)
            const laborRes = resources.find((r: any) => r.name === 'Labor');
            if (!laborRes) {
              log(`[SKIP] Labor-for-resource prod: Labor not found for ${resource.name} in realm ${entityId}.`, 'info', 'AutoResourceProducer');
              return null;
            }
            const availableLabor = laborRes.amount * (resource.percentOfLaborForProd / 100);
            const cycles = Math.floor(availableLabor / laborInput.amount);
            if (cycles === 0) {
              log(`[SKIP] Labor-for-resource prod: Not enough labor for ${resource.name} in realm ${entityId}.`, 'info', 'AutoResourceProducer');
              return null;
            }
            if (cycles !== availableLabor / laborInput.amount) {
              log(`[ADJUST] Labor-for-resource prod: Cycles for ${resource.name} in realm ${entityId} adjusted from ${availableLabor / laborInput.amount} to ${cycles} for precision.`, 'info', 'AutoResourceProducer');
            }
            return { resourceId, amount: cycles };
          })
          .filter(Boolean);
        log(`[BatchProduce] Labor-for-resource resources for realm ${entityId}: ${JSON.stringify(laborForResourceResources)}`, 'info', 'AutoResourceProducer');
        if (laborForResourceResources.length > 0 && systemCalls.burn_labor_for_resource_production) {
          log(`[Step ${currentStep} of ${totalSteps}] Preparing to burn resources for labor-for-resource production in realm ${entityId}. Payload: ${JSON.stringify({ from_entity_id: entityId, production_cycles: laborForResourceResources.map((r: any) => r.amount), produced_resource_types: laborForResourceResources.map((r: any) => r.resourceId) })}`, 'info', 'AutoResourceProducer');
          try {
            log(`[Step ${currentStep} of ${totalSteps}] Calling burn_labor_for_resource_production...`, 'info', 'AutoResourceProducer');
            await systemCalls.burn_labor_for_resource_production({
              from_entity_id: entityId,
              production_cycles: laborForResourceResources.map((r: any) => r.amount),
              produced_resource_types: laborForResourceResources.map((r: any) => r.resourceId),
              signer: account,
            });
            log(`[Step ${currentStep} of ${totalSteps}] Burned resources for labor-for-resource production in realm ${entityId}.`, 'success', 'AutoResourceProducer');
          } catch (e) {
            log(`[Step ${currentStep} of ${totalSteps}] ERROR during burn_labor_for_resource_production for realm ${entityId}: ${(e as Error).message}`, 'error', 'AutoResourceProducer');
            throw e;
          }
          currentStep++;
        }
      }
      log('Batch production complete.', 'success', 'AutoResourceProducer');
    } catch (error) {
      log(`Error during batch production: ${(error as Error).message}`, 'error', 'AutoResourceProducer');
    } finally {
      setIsLoading(false);
    }
  }, [jsonDataOutput, systemCalls, account, log]);

  const textAreaStyle: React.CSSProperties = {
    width: "100%",
    minHeight: "200px",
    marginTop: "6px",
    padding: "6px",
    border: "1px solid #777",
    borderRadius: "4px",
    backgroundColor: "#222",
    color: "white",
    fontFamily: "monospace",
    fontSize: "0.85em",
    boxSizing: "border-box",
  };
  const buttonStyle: React.CSSProperties = {
    padding: "6px 12px",
    margin: "0 0 6px 0",
    backgroundColor: "#007bff",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.95em",
    opacity: isLoading ? 0.7 : 1,
  };

  return (
    <div style={{ padding: 0, border: "none", margin: 0 }}>
      <textarea
        style={textAreaStyle}
        value={jsonDataOutput}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setJsonDataOutput(e.target.value)}
        placeholder={"JSON output will appear here..."}
      />
      <button
        style={buttonStyle}
        onClick={handleFetchAllRealmsResources}
        disabled={isLoading || !components}
      >
        {isLoading ? "Querying..." : "Fetch data"}
      </button>
      <button
        style={{ ...buttonStyle, backgroundColor: '#28a745', marginLeft: 8 }}
        onClick={handleBatchProduce}
        disabled={isLoading || !systemCalls}
      >
        {isLoading ? "Processing..." : "Batch Produce from JSON"}
      </button>
    </div>
  );
};
