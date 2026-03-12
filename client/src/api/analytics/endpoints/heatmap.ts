import { authedFetch } from "../../utils";
import { CommonApiParams, toQueryParams } from "./types";

export interface HeatmapPage {
  pathname: string;
  click_count: number;
  unique_sessions: number;
}

export interface HeatmapClick {
  selector: string;
  x: number;
  y: number;
  scroll_x: number;
  scroll_y: number;
  viewport_width: number;
}

export interface HeatmapSnapshotResponse {
  events: Array<{
    timestamp: number;
    type: string | number;
    data: any;
  }>;
  metadata: any;
}

export interface HeatmapClicksParams extends CommonApiParams {
  pathname: string;
}

/**
 * Fetch heatmap pages with click counts
 * GET /api/sites/:siteId/heatmap/pages
 */
export async function fetchHeatmapPages(site: string | number, params: CommonApiParams): Promise<HeatmapPage[]> {
  return authedFetch<HeatmapPage[]>(`/sites/${site}/heatmap/pages`, toQueryParams(params));
}

/**
 * Fetch individual heatmap clicks with selectors and coordinates
 * GET /api/sites/:siteId/heatmap/clicks
 */
export async function fetchHeatmapClicks(
  site: string | number,
  params: HeatmapClicksParams
): Promise<HeatmapClick[]> {
  return authedFetch<HeatmapClick[]>(`/sites/${site}/heatmap/clicks`, {
    ...toQueryParams(params),
    pathname: params.pathname,
  });
}

/**
 * Fetch an rrweb snapshot for rendering the page background
 * GET /api/sites/:siteId/heatmap/snapshot
 */
export async function fetchHeatmapSnapshot(
  site: string | number,
  pathname: string,
  deviceType?: string
): Promise<HeatmapSnapshotResponse> {
  return authedFetch<HeatmapSnapshotResponse>(`/sites/${site}/heatmap/snapshot`, {
    pathname,
    deviceType,
  });
}
