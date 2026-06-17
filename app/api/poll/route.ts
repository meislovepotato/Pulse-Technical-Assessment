import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { STALE_MS } from "@/lib/presence";
import type { PollResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * IMPORTANT ARCHITECTURE RULES:
 * - poll MUST NOT mutate global state except lastSeen
 * - cleanup MUST NOT run inside request handlers
 * - presence deletion is server-owned only
 */

// GET /api/poll?id= — the single endpoint that drives the live map.

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get("id");

  if (!id) {
    return Response.json({ error: "missing id" }, { status: 400 });
  }

  const now = Date.now();
  const heartbeatTime = new Date(now);
  const staleCutoff = new Date(now - STALE_MS);

  // 1) Heartbeat — refresh lastSeen for the caller.
  await prisma.presence.updateMany({
    where: { id },
    data: { lastSeen: heartbeatTime },
  });

  // NOTE: Cleanup must NOT run inside poll — server-owned only. See
  // /api/cleanup for TTL and stale presence reaping.

  // 2. Fetch peers (server-consistent view)
  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id },
      lastSeen: { gte: staleCutoff },
    },
    select: { id: true, lat: true, lng: true, busy: true },
  });

  /*
  // Debug: log poll activity and returned peer ids.
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[poll] id=${id} peers=${peers.length} ids=${peers.map((p) => p.id).join(",")}`,
    );
  } catch {}
  */

  // 3. Fetch signals (read only)
  const inbox = await prisma.signal.findMany({
    where: { toId: id },
    orderBy: { createdAt: "asc" },
  });

  // NOTE: Poll should be read-only (aside from lastSeen). Do NOT delete
  // signals here — server-side cleanup will remove old signals.

  // 4. Read this user's mailbox (no deletion in poll)
  const response: PollResponse = {
    peers: peers.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
    })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return Response.json(response);
}
