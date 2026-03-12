import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { processResults, getTimeStatement } from "../../api/analytics/utils/utils.js";
import { FilterParams } from "@rybbit/shared";

export interface HeatmapPage {
  pathname: string;
  click_count: number;
  unique_sessions: number;
}

export interface HeatmapClick {
  x: number;
  y: number;
  scroll_x: number;
  scroll_y: number;
  viewport_width: number;
  viewport_height: number;
}

export class HeatmapService {
  async getHeatmapPages(siteId: number, params: FilterParams): Promise<HeatmapPage[]> {
    const timeStatement = getTimeStatement(params);

    const query = `
      SELECT
        pathname,
        count() as click_count,
        uniq(session_id) as unique_sessions
      FROM heatmap_clicks
      WHERE site_id = {siteId:UInt16}
        ${timeStatement}
      GROUP BY pathname
      ORDER BY click_count DESC
      LIMIT 100
    `;

    const result = await clickhouse.query({
      query,
      query_params: { siteId },
      format: "JSONEachRow",
    });

    return processResults<HeatmapPage>(result);
  }

  async getHeatmapClicks(
    siteId: number,
    pathname: string,
    deviceType: string | undefined,
    params: FilterParams
  ): Promise<HeatmapClick[]> {
    const timeStatement = getTimeStatement(params);

    let deviceFilter = "";
    if (deviceType === "desktop") {
      deviceFilter = "AND viewport_width >= 1024";
    } else if (deviceType === "mobile") {
      deviceFilter = "AND viewport_width < 768";
    }

    const query = `
      SELECT
        x, y, scroll_x, scroll_y, viewport_width, viewport_height
      FROM heatmap_clicks
      WHERE site_id = {siteId:UInt16}
        AND pathname = {pathname:String}
        ${deviceFilter}
        ${timeStatement}
      LIMIT 10000
    `;

    const result = await clickhouse.query({
      query,
      query_params: { siteId, pathname },
      format: "JSONEachRow",
    });

    return processResults<HeatmapClick>(result);
  }
}
