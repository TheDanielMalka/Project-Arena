import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { createWeb3Modal } from "@web3modal/wagmi/react";

const BSC_TESTNET_RPC = "https://data-seed-prebsc-1-s1.binance.org:8545/";
const BSC_MAINNET_RPC = "https://bsc-dataseed1.binance.org/";

export const bscTestnet = defineChain({
  id: 97,
  name: "BNB Smart Chain Testnet",
  nativeCurrency: { decimals: 18, name: "tBNB", symbol: "tBNB" },
  rpcUrls: {
    default: { http: [BSC_TESTNET_RPC] },
    public:  { http: [BSC_TESTNET_RPC] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://testnet.bscscan.com" },
  },
  testnet: true,
});

export const bscMainnet = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { decimals: 18, name: "BNB", symbol: "BNB" },
  rpcUrls: {
    default: { http: [BSC_MAINNET_RPC] },
    public:  { http: [BSC_MAINNET_RPC] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
});

const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "";

export const wagmiConfig = createConfig({
  chains: [bscTestnet, bscMainnet],
  connectors: [
    injected(),
    walletConnect({ projectId }),
    coinbaseWallet({ appName: "ProjectArena" }),
  ],
  transports: {
    [bscTestnet.id]: http(BSC_TESTNET_RPC),
    [bscMainnet.id]: http(BSC_MAINNET_RPC),
  },
});

/**
 * Web3Modal singleton — initialised once at module load.
 * Provides QR-code modal on desktop and deep-link on mobile.
 * Opened via web3modal.open() or the useWeb3Modal() hook.
 */
export const web3modal = createWeb3Modal({
  wagmiConfig,
  projectId,
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent":               "hsl(220 100% 60%)",
    "--w3m-border-radius-master": "2px",
  },
});
