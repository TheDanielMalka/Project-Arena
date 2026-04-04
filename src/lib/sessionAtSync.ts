import { useWalletStore } from "@/stores/walletStore";
import { useForgeStore } from "@/stores/forgeStore";
import type { UserProfile } from "@/types";

/** Mirror server AT into wallet + forge only — caller updates `user` if needed */
export function publishAtToWalletAndForge(at: number): void {
  useWalletStore.setState({ atBalance: at });
  useForgeStore.setState({ arenaTokens: at });
}

export function hydrateWalletForgeAfterAuth(user: UserProfile): void {
  publishAtToWalletAndForge(user.atBalance);
  useWalletStore.setState({
    usdtBalance: 0,
    dailyBettingUsed: 0,
    transactions: [],
    connectedAddress: user.walletAddress,
    selectedNetwork: "bsc",
  });
}

export function resetWalletForgeForLogout(): void {
  useWalletStore.setState({
    connectedAddress: null,
    usdtBalance: 0,
    atBalance: 0,
    dailyBettingUsed: 0,
    transactions: [],
    selectedNetwork: "bsc",
  });
  useForgeStore.setState({ arenaTokens: 0 });
}
