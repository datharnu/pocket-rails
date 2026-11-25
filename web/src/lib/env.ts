import { isAddress, type Address, type Chain } from "viem";
import { aevumFork, aevumTestnet, localAnvil } from "@aevum-kit/aevum";

export type NetworkKey = "aevum" | "fork" | "local";

export interface Network {
  key: NetworkKey;
  /** Short name for the network switcher. */
  label: string;
  chain: Chain;
  /** PocketRails on this network, if deployed. */
  rails?: Address;
  /** Block PocketRails was deployed at: history is read from here (1,000 blocks per call). */
  railsDeployBlock?: bigint;
  /** Explorer links only make sense on the real testnet. */
  hasExplorer: boolean;
}

const address = (v: string | undefined): Address | undefined => (v && isAddress(v.trim()) ? (v.trim() as Address) : undefined);
const block = (v: string | undefined): bigint | undefined => (v && /^\d+$/.test(v.trim()) ? BigInt(v.trim()) : undefined);

// NEXT_PUBLIC_* values must be written out in full so Next.js can inline them into the browser bundle.
const all: Record<NetworkKey, Network> = {
  aevum: {
    key: "aevum",
    label: "Aevum testnet",
    chain: aevumTestnet,
    rails: address(process.env.NEXT_PUBLIC_RAILS_AEVUM),
    railsDeployBlock: block(process.env.NEXT_PUBLIC_RAILS_DEPLOY_BLOCK_AEVUM),
    hasExplorer: true,
  },
  fork: {
    key: "fork",
    label: "Local fork",
    chain: aevumFork,
    rails: address(process.env.NEXT_PUBLIC_RAILS_FORK),
    railsDeployBlock: block(process.env.NEXT_PUBLIC_RAILS_DEPLOY_BLOCK_FORK),
    hasExplorer: false,
  },
  local: {
    key: "local",
    label: "Local anvil",
    chain: localAnvil,
    rails: address(process.env.NEXT_PUBLIC_RAILS_LOCAL),
    railsDeployBlock: block(process.env.NEXT_PUBLIC_RAILS_DEPLOY_BLOCK_LOCAL),
    hasExplorer: false,
  },
};

const requested = (process.env.NEXT_PUBLIC_NETWORKS ?? "aevum")
  .split(",")
  .map((k) => k.trim())
  .filter((k): k is NetworkKey => k in all);

/** The networks the app offers, in the order of NEXT_PUBLIC_NETWORKS. The first one is the default. */
export const networks: [Network, ...Network[]] = (() => {
  const keys = [...new Set(requested)];
  const list = (keys.length ? keys : (["aevum"] as NetworkKey[])).map((k) => all[k]);
  return list as [Network, ...Network[]];
})();

export const defaultNetwork = networks[0];

export function networkByChainId(chainId: number | undefined): Network | undefined {
  return networks.find((n) => n.chain.id === chainId);
}

export function networkByKey(key: string | null | undefined): Network | undefined {
  return networks.find((n) => n.key === key);
}

export const walletConnectProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || undefined;

export const repoUrl = (process.env.NEXT_PUBLIC_REPO_URL?.trim() || "https://github.com/datharnu/pocket-rails").replace(/\.git$|\/+$/g, "");

/**
 * Demo mode: optional addresses that pre-fill forms, so a first-time visitor can create a vault, grant
 * school billing or set a guardian in one click. Purely a convenience: every field stays editable.
 */
export const demo = {
  child: address(process.env.NEXT_PUBLIC_DEMO_CHILD),
  school: address(process.env.NEXT_PUBLIC_DEMO_SCHOOL),
  guardian: address(process.env.NEXT_PUBLIC_DEMO_GUARDIAN),
};
