import { defineChain, createPublicClient, http, formatEther } from "viem";

export const API_ORIGIN = "https://clank.trade";
export const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = "https://robinhoodchain.blockscout.com";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.CLANK_RPC_URL || DEFAULT_RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
});

export function publicClient() {
  return createPublicClient({
    chain: robinhood,
    transport: http(process.env.CLANK_RPC_URL || DEFAULT_RPC),
  });
}

export async function platformConfig() {
  const response = await fetch(`${API_ORIGIN}/v1/config`);
  if (!response.ok) {
    throw new Error(`Could not read clank.trade config (${response.status}).`);
  }
  const config = await response.json();
  if (config.chainId !== robinhood.id) {
    throw new Error(`Chain ID does not match: ${config.chainId}.`);
  }
  return config;
}

export function eth(wei) {
  return `${formatEther(wei)} ETH`;
}
