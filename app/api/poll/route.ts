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
  const staleCutoff = new Date(now - STALE_MS);

  // 1) Heartbeat — refresh lastSeen for the caller.
  await prisma.presence.updateMany({
    where: { lastSeen: { lt: staleCutoff }, busy: true },
    data: { busy: false },
  });

  // NOTE: Cleanup must NOT run inside poll — server-owned only. See
  // /api/cleanup for TTL and stale presence reaping.

  // 2. Fetch peers (server-consistent view)
  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id },
      lastSeen: { gte: staleCutoff },
    },
    select: { id: true, lat: true, lng: true, busy: true, lastSeen: true },
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

  // 3. Fetch signals and remove them atomically so the same signal isn't
  // delivered repeatedly across multiple polls. We read the rows and delete
  // them in a single transaction, returning the fetched messages.
  const inbox = await prisma.$transaction(async (tx) => {
    const msgs = await tx.signal.findMany({
      where: { toId: id },
      orderBy: { createdAt: "asc" },
    });
    if (msgs.length > 0) {
      const ids = msgs.map((m) => m.id);
      await tx.signal.deleteMany({ where: { id: { in: ids } } });
    }
    const validSignals = msgs.filter((s) => {
      const age = Date.now() - new Date(s.createdAt).getTime();
      return age < STALE_MS * 2; // safety window
    });
    return validSignals;
  });

  // 4. Read this user's mailbox (no deletion in poll)
  const peersWithStatus = peers.map((p) => {
    const isStale = Date.now() - new Date(p.lastSeen).getTime() > STALE_MS;

    return {
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
      stale: isStale,
    };
  });
  const response: PollResponse = {
    peers: peersWithStatus,
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
