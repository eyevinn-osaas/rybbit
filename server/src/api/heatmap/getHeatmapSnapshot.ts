import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { processResults } from "../../api/analytics/utils/utils.js";
import { SessionReplayQueryService } from "../../services/replay/sessionReplayQueryService.js";

export async function getHeatmapSnapshot(
  request: FastifyRequest<{
    Params: { siteId: string };
    Querystring: {
      pathname: string;
      deviceType?: string;
    };
  }>,
  reply: FastifyReply
) {
  try {
    const siteId = Number(request.params.siteId);
    const { pathname, deviceType } = request.query;

    if (!pathname) {
      return reply.status(400).send({ error: "pathname is required" });
    }

    let deviceFilter = "";
    if (deviceType === "desktop") {
      deviceFilter = "AND screen_width >= 1024";
    } else if (deviceType === "mobile") {
      deviceFilter = "AND screen_width < 768";
    }

    // Find a recent session that visited this pathname
    const sessionResult = await clickhouse.query({
      query: `
        SELECT session_id
        FROM session_replay_metadata
        FINAL
        WHERE site_id = {siteId:UInt16}
          AND path(page_url) = {pathname:String}
          ${deviceFilter}
          AND session_id IN (
            SELECT DISTINCT session_id
            FROM session_replay_events
            WHERE site_id = {siteId:UInt16} AND event_type = '2'
          )
        ORDER BY start_time DESC
        LIMIT 1
      `,
      query_params: { siteId, pathname },
      format: "JSONEachRow",
    });

    const sessions = await processResults<{ session_id: string }>(sessionResult);

    if (sessions.length === 0) {
      return reply.status(404).send({ error: "No session replay found for this page" });
    }

    // Get the replay events for this session
    const queryService = new SessionReplayQueryService();
    const replayData = await queryService.getSessionReplayEvents(siteId, sessions[0].session_id);

    // Filter to only FullSnapshot (type 2) and Meta (type 4) events for rendering
    const snapshotEvents = replayData.events.filter((event: any) => {
      const eventType = typeof event.type === "string" ? parseInt(event.type) : event.type;
      return eventType === 2 || eventType === 4;
    });

    return reply.send({
      events: snapshotEvents,
      metadata: replayData.metadata,
    });
  } catch (error) {
    console.error("Error fetching heatmap snapshot:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
}
