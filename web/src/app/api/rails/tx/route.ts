import { NextResponse } from "next/server";
import { createPublicClient, http, isHex, TransactionReceiptNotFoundError, type Hash } from "viem";
import { decodeOutcome } from "@pocket-rails/sdk";
import { defaultNetwork, networkByChainId } from "@/lib/env";

/**
 * GET /api/rails/tx?hash=0x…&chainId=… → what a PocketRails transaction did.
 *   { state: "unknown" }                 not confirmed yet (or the RPC didn't answer): assume nothing
 *   { state: "confirmed", outcome }      allow / refuse (+ reason) / pending / other / failed
 * Aevum has no WebSocket RPC, so clients poll this every couple of seconds.
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hash = url.searchParams.get("hash");
  const chainId = url.searchParams.get("chainId");
  const net = chainId ? networkByChainId(Number(chainId)) : defaultNetwork;
  if (!net?.rails) return NextResponse.json({ error: "This network isn't enabled in the app." }, { status: 400 });
  if (!(hash && isHex(hash) && hash.length === 66)) return NextResponse.json({ error: "Malformed hash." }, { status: 400 });

  const client = createPublicClient({ chain: net.chain, transport: http() });
  try {
    const receipt = await client.getTransactionReceipt({ hash: hash as Hash });
    const outcome = decodeOutcome(receipt, net.rails);
    // bigint isn't JSON: send block numbers and amounts as decimal strings.
    const body = JSON.parse(JSON.stringify({ state: "confirmed", outcome }, bigintReplacer));
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof TransactionReceiptNotFoundError) return NextResponse.json({ state: "unknown", why: "Not confirmed yet." });
    return NextResponse.json({ state: "unknown", why: "Couldn't reach the network. Nothing is assumed." });
  }
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
