import { NextResponse } from "next/server";
import { defaultNetwork, networkByChainId } from "@/lib/env";
import { railsEvents, type RailsEvent } from "@/lib/indexer";

/**
 * GET /api/rails/events?chainId=…&vaultId=…  →  { events, scannedTo }
 * A vault's history, newest first: rule changes, payments, refusals, exception requests and decisions,
 * billing permissions and every charge. Each event carries its transaction hash for an explorer link.
 */
export const runtime = "nodejs";

const BILLING_EVENTS = new Set(["ChargeRequested", "ChargeRefused", "ChargeVetoed", "ChargeApproved", "ChargeSettled", "ChargeFailed"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainId = url.searchParams.get("chainId");
  const vaultId = url.searchParams.get("vaultId");
  const net = chainId ? networkByChainId(Number(chainId)) : defaultNetwork;
  if (!net?.rails) return NextResponse.json({ error: "This network isn't enabled in the app." }, { status: 400 });
  if (vaultId !== null && !/^\d{1,30}$/.test(vaultId)) return NextResponse.json({ error: "Malformed vault id." }, { status: 400 });

  try {
    const { events, scannedTo } = await railsEvents(net);
    let out: RailsEvent[] = events;
    if (vaultId !== null) {
      // Billing events carry a billingId, not a vaultId: map them through BillingGranted.
      const billingToVault = new Map<string, string>();
      for (const e of events) if (e.eventName === "BillingGranted") billingToVault.set(String(e.args.billingId), String(e.args.vaultId));
      out = events.filter((e) =>
        BILLING_EVENTS.has(e.eventName) ? billingToVault.get(String(e.args.billingId)) === vaultId : String(e.args.vaultId) === vaultId,
      );
    }
    const sorted = [...out].sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) || b.logIndex - a.logIndex);
    return NextResponse.json({ events: sorted.slice(0, 300), scannedTo }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read history from the network. Try again in a moment." }, { status: 503 });
  }
}
