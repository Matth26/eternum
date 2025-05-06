import { env } from "@/../env";
import { getSeasonPassAddress } from "@/utils/addresses";
import { useDojo } from "@bibliothecadao/react";
import React, { useState } from 'react';

interface RealmSettlementInput {
  realm_id: number;
  realm_settlement: {
    side: number;
    layer: number;
    point: number;
  };
}

export const BatchRealmSettleScript: React.FC = () => {
  const {
    account: { account },
    setup: {
      systemCalls: { create_multiple_realms },
    },
  } = useDojo();

  const [jsonData, setJsonData] = useState<string>(`[
  {
    "realm_id": 1234,
    "realm_settlement": { "side": 0, "layer": 2, "point": 0 }
  }
]`);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string>('');

  const handleSettle = async () => {
    if (!account || !create_multiple_realms) {
      setFeedback('Error: Account or system call not available.');
      return;
    }

    let parsedData: RealmSettlementInput[];
    try {
      parsedData = JSON.parse(jsonData);
      if (!Array.isArray(parsedData) || parsedData.some(item => 
        typeof item.realm_id !== 'number' || 
        typeof item.realm_settlement !== 'object' || 
        typeof item.realm_settlement.side !== 'number' ||
        typeof item.realm_settlement.layer !== 'number' ||
        typeof item.realm_settlement.point !== 'number'
      )) {
        throw new Error('Invalid data structure in JSON.');
      }
    } catch (error) {
      setFeedback(`Error parsing JSON: ${(error as Error).message}`);
      return;
    }

    if (parsedData.length === 0) {
      setFeedback('No realm data provided.');
      return;
    }

    setIsLoading(true);
    setFeedback('Settling realms...');

    try {
      if (!env || !env.VITE_PUBLIC_CLIENT_FEE_RECIPIENT) {
        throw new Error('Client fee recipient address is not configured in env.');
      }

      await create_multiple_realms({
        realms: parsedData,
        owner: account.address,
        frontend: env.VITE_PUBLIC_CLIENT_FEE_RECIPIENT,
        signer: account,
        season_pass_address: getSeasonPassAddress(),
      });
      setFeedback(`Successfully settled ${parsedData.length} realm(s).`);
    } catch (error) {
      console.error("Error settling realms:", error);
      setFeedback(`Error settling realms: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const textAreaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '150px',
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
    backgroundColor: '#5cb85c',
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
    whiteSpace: 'pre-wrap',
  };

  return (
    <div>
      <h4>Batch Settle Realms</h4>
      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
        Paste JSON data for realms to settle. Each object needs `realm_id` (number) and `realm_settlement` (object with `side`, `layer`, `point` as numbers).
      </p>
      <textarea
        style={textAreaStyle}
        value={jsonData}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setJsonData(e.target.value)}
        placeholder='[{"realm_id": 1, "realm_settlement": {"side":0, "layer":2, "point":0}}, ...]'
        disabled={isLoading}
      />
      <button 
        style={buttonStyle}
        onClick={handleSettle} 
        disabled={isLoading}
      >
        {isLoading ? 'Processing...' : 'Settle Realms'}
      </button>
      {feedback && (
        <div style={feedbackStyle}>
          {feedback}
        </div>
      )}
    </div>
  );
}; 