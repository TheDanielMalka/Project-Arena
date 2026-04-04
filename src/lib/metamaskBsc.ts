import { BrowserProvider, getAddress } from "ethers";

/** EIP-155 chain id — default BSC Testnet (97). Override with `VITE_CHAIN_ID`. */
export function getArenaTargetChainId(): number {
  const raw = import.meta.env.VITE_CHAIN_ID;
  const n = raw !== undefined && raw !== "" ? Number.parseInt(String(raw), 10) : 97;
  return Number.isFinite(n) && n > 0 ? n : 97;
}

const BSC_TESTNET_ADD_CHAIN = {
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.binance.org:8545/"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
} as const;

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
}

export function getInjectedEthereum(): EthereumProvider | null {
  const g = globalThis as unknown as { ethereum?: EthereumProvider & { providers?: EthereumProvider[] } };
  const eth = g.ethereum;
  if (!eth?.request) return null;
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const mm = eth.providers.find((p) => p.isMetaMask);
    return mm ?? eth.providers[0]!;
  }
  return eth;
}

function toChainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

/**
 * Switch MetaMask to the configured chain (BSC Testnet by default).
 * Adds the chain if missing (code 4902).
 */
export async function ensureTargetChain(ethereum: EthereumProvider): Promise<void> {
  const target = getArenaTargetChainId();
  const hex = toChainIdHex(target);
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code;
    if (code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hex,
            chainName: BSC_TESTNET_ADD_CHAIN.chainName,
            nativeCurrency: BSC_TESTNET_ADD_CHAIN.nativeCurrency,
            rpcUrls: [...BSC_TESTNET_ADD_CHAIN.rpcUrls],
            blockExplorerUrls: [...BSC_TESTNET_ADD_CHAIN.blockExplorerUrls],
          },
        ],
      });
      return;
    }
    throw e;
  }
}

/** Human-readable message signed with personal_sign (EIP-191) — proves key ownership; safer than raw eth_sign. */
export function buildWalletOwnershipMessage(walletAddress: string): string {
  const contract = import.meta.env.VITE_CONTRACT_ADDRESS ?? "";
  const chainId = getArenaTargetChainId();
  const nonce = `${Date.now()}`;
  const checksummed = getAddress(walletAddress);
  return [
    "ProjectArena — prove wallet ownership",
    "",
    `wallet_address: ${checksummed}`,
    `chain_id: ${chainId}`,
    `contract: ${contract}`,
    `nonce: ${nonce}`,
  ].join("\n");
}

export async function connectMetaMaskAndSignOwnership(): Promise<{ address: string; signature: string }> {
  const eth = getInjectedEthereum();
  if (!eth) {
    throw new Error("No injected wallet found. Install MetaMask (or another EIP-1193 wallet).");
  }
  await ensureTargetChain(eth);
  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  const address = getAddress(await signer.getAddress());
  const message = buildWalletOwnershipMessage(address);
  const signature = await signer.signMessage(message);
  return { address, signature };
}
