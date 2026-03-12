import { FastifyReply, FastifyRequest } from "fastify";
import { HeatmapService } from "../../services/heatmap/heatmapService.js";

export async function getHeatmapPages(
  request: FastifyRequest<{
    Params: { siteId: string };
    Querystring: {
      start_date?: string;
      end_date?: string;
      time_zone?: string;
      past_minutes_start?: string;
      past_minutes_end?: string;
    };
  }>,
  reply: FastifyReply
) {
  try {
    const siteId = Number(request.params.siteId);
    const { start_date, end_date, time_zone, past_minutes_start, past_minutes_end } = request.query;

    const heatmapService = new HeatmapService();
    const pages = await heatmapService.getHeatmapPages(siteId, {
      start_date: start_date || "",
      end_date: end_date || "",
      time_zone: time_zone || "",
      filters: "",
      past_minutes_start: past_minutes_start ? Number(past_minutes_start) : undefined,
      past_minutes_end: past_minutes_end ? Number(past_minutes_end) : undefined,
    });

    return reply.send(pages);
  } catch (error) {
    console.error("Error fetching heatmap pages:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
}
