import { env } from "@/../env";
import { getSeasonPassAddress } from "@/utils/addresses";
import { getOffchainRealm } from "@bibliothecadao/eternum";
import { useDojo } from "@bibliothecadao/react";
import { RealmInterface } from "@bibliothecadao/types";
import { gql } from "graphql-request";
import React, { useState } from 'react';
import { addAddressPadding } from "starknet";

interface SeasonPassInfo {
  realmId: number;
  name: string;
  tokenId: string;
}

// Function to query season passes, adapted from settle-realm-component.tsx
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
        Accept: "application/graphql-response+json", // Corrected Accept header
      },
      body: JSON.stringify({
        query: getAccountTokensQuery,
        variables: { accountAddress },
      }),
    });
    const json = await response.json();

    if (json.errors) {
      console.error("GraphQL Errors:", json.errors);
      throw new Error("Error fetching tokens from GraphQL: " + json.errors.map((e: any) => e.message).join(", "));
    }
    if ("data" in json && json.data) {
      return json.data.tokenBalances?.edges || [];
    }
    throw new Error("No data returned from GraphQL or unexpected structure.");
  } catch (error) {
    console.error("Error querying player tokens:", error);
    throw error; // Re-throw to be caught by the handler
  }
};


export const GetMySeasonPassesScript: React.FC = () => {
  const {
    account: { account },
  } = useDojo();

  const [jsonDataOutput, setJsonDataOutput] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string>('');

  const handleGetPasses = async () => {
    if (!account?.address) {
      setFeedback('Error: Account not available. Please connect wallet.');
      return;
    }

    setIsLoading(true);
    setFeedback('Fetching your season passes...');
    setJsonDataOutput('');

    try {
      const playerTokens = await queryAllPlayerTokens(account.address);
      const seasonPassContractAddress = await getSeasonPassAddress();
      
      const seasonPasses: SeasonPassInfo[] = [];

      for (const edge of playerTokens) {
        const tokenMetadata = edge?.node?.tokenMetadata;
        if (
          tokenMetadata &&
          tokenMetadata.__typename === "ERC721__Token" &&
          tokenMetadata.contractAddress &&
          tokenMetadata.tokenId &&
          addAddressPadding(tokenMetadata.contractAddress) === addAddressPadding(seasonPassContractAddress)
        ) {
          const realmData: RealmInterface | undefined = getOffchainRealm(Number(tokenMetadata.tokenId));
          if (realmData) {
            seasonPasses.push({
              realmId: realmData.realmId,
              name: realmData.name,
              tokenId: tokenMetadata.tokenId,
            });
          } else {
            console.warn(`Could not get offchain realm data for tokenId: ${tokenMetadata.tokenId}`);
          }
        }
      }
      
      // Sort by realmId for consistent output
      seasonPasses.sort((a, b) => a.realmId - b.realmId);

      const outputObject = {
        totalPassesFound: seasonPasses.length,
        seasonPasses: seasonPasses,
      };

      setJsonDataOutput(JSON.stringify(outputObject, null, 2));
      setFeedback(`Successfully fetched ${seasonPasses.length} season pass(es).`);
      
    } catch (error) {
      console.error("Error fetching season passes:", error);
      setFeedback(`Error: ${(error as Error).message}`);
      setJsonDataOutput('');
    } finally {
      setIsLoading(false);
    }
  };

  // Styles (can be reused or defined in a common place)
  const textAreaStyle: React.CSSProperties = { /* ... same as other scripts ... */ width: '100%', minHeight: '200px', marginTop: '10px', padding: '8px', border: '1px solid #777', borderRadius: '4px', backgroundColor: '#333', color: 'white', fontFamily: 'monospace', fontSize: '0.9em', boxSizing: 'border-box' };
  const buttonStyle: React.CSSProperties = { /* ... same as other scripts ... */ padding: '10px 15px', marginTop: '10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1em', opacity: isLoading ? 0.7 : 1 };
  const feedbackStyle: React.CSSProperties = { /* ... same as other scripts ... */  marginTop: '10px', padding: '8px', backgroundColor: feedback.startsWith('Error:') ? '#d9534f' : '#5bc0de', color: 'white', borderRadius: '4px', fontSize: '0.9em', whiteSpace: 'pre-wrap' };

  return (
    <div>
      <h4>Get My Season Passes (JSON)</h4>
      <p style={{ fontSize: '0.85em', marginBottom: '10px' }}>
        This script fetches all your Season Passes and lists their Realm ID, Name, and Token ID.
      </p>
      <button 
        style={buttonStyle}
        onClick={handleGetPasses} 
        disabled={isLoading || !account?.address}
      >
        {isLoading ? 'Fetching...' : 'Get My Season Passes'}
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
          placeholder='JSON output of your season passes will appear here...'
        />
      )}
    </div>
  );
}; 