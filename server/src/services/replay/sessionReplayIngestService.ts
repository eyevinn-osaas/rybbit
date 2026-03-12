import { DateTime } from "luxon";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { RecordSessionReplayRequest } from "../../types/sessionReplay.js";
import { processResults } from "../../api/analytics/utils/utils.js";
import { parseTrackingData } from "./trackingUtils.js";
import { sessionsService } from "../sessions/sessionsService.js";
import { userIdService } from "../userId/userIdService.js";
import { r2Storage } from "../storage/r2StorageService.js";
import { siteConfig } from "../../lib/siteConfig.js";

export interface RequestMetadata {
  userAgent: string;
  ipAddress: string;
  origin: string;
  referrer: string;
}

// In-memory cache of FullSnapshot node trees per session, used to resolve
// rrweb node IDs to CSS selectors when processing click events.
const snapshotSelectorCache = new Map<string, { map: Map<number, string>; ts: number }>();
const SNAPSHOT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const SNAPSHOT_CACHE_MAX = 5000;

/**
 * Build a CSS selector for every element node in an rrweb serialised DOM tree.
 * Uses `[id="…"]` when an element has an id (globally unique, stops the chain)
 * and `tag:nth-of-type(n)` otherwise, chained from the nearest id ancestor (or body).
 */
function buildSelectorMap(rootNode: any): Map<number, string> {
  const map = new Map<number, string>();

  function traverse(node: any, parentNode: any, parentSelector: string) {
    if (!node) return;

    // Element node (type 2 in rrweb's serialised format)
    if (node.type === 2) {
      const tag = node.tagName?.toLowerCase();
      if (!tag) return;

      let selector: string;
      const htmlId = node.attributes?.id;

      if (htmlId && typeof htmlId === "string" && htmlId.trim()) {
        // Element has an id – use attribute selector (handles special chars)
        selector = `[id="${htmlId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
      } else {
        // Compute nth-of-type position among same-tag siblings
        let nth = 1;
        if (parentNode?.childNodes) {
          for (const sib of parentNode.childNodes) {
            if (sib === node) break;
            if (sib.type === 2 && sib.tagName?.toLowerCase() === tag) nth++;
          }
        }
        const segment = `${tag}:nth-of-type(${nth})`;
        selector = parentSelector ? `${parentSelector}>${segment}` : segment;
      }

      if (node.id !== undefined) {
        map.set(node.id, selector);
      }

      if (node.childNodes) {
        for (const child of node.childNodes) {
          traverse(child, node, selector);
        }
      }
    } else if (node.childNodes) {
      // Document / doctype / other wrapper – pass through
      for (const child of node.childNodes) {
        traverse(child, node, parentSelector);
      }
    }
  }

  traverse(rootNode, null, "");
  return map;
}

/** Evict stale entries from the snapshot cache. */
function pruneSnapshotCache() {
  if (snapshotSelectorCache.size <= SNAPSHOT_CACHE_MAX) return;
  const now = Date.now();
  for (const [key, entry] of snapshotSelectorCache) {
    if (now - entry.ts > SNAPSHOT_CACHE_TTL) {
      snapshotSelectorCache.delete(key);
    }
  }
  // If still over max, drop oldest
  if (snapshotSelectorCache.size > SNAPSHOT_CACHE_MAX) {
    const entries = [...snapshotSelectorCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toRemove = entries.slice(0, entries.length - SNAPSHOT_CACHE_MAX);
    for (const [key] of toRemove) snapshotSelectorCache.delete(key);
  }
}

/**
 * Service responsible for ingesting session replay data
 * Handles recording events and updating metadata
 */
export class SessionReplayIngestService {
  async recordEvents(
    siteId: number,
    request: RecordSessionReplayRequest,
    requestMeta?: RequestMetadata
  ): Promise<void> {
    const { userId: clientUserId, events, metadata } = request;

    // Always generate device fingerprint (anonymous user ID) server-side
    const deviceFingerprint = await userIdService.generateUserId(
      requestMeta?.ipAddress || "",
      requestMeta?.userAgent || "",
      siteId
    );

    // Check if client provided an identified user ID (different from device fingerprint)
    const trimmedClientUserId = clientUserId?.trim() || "";
    const identifiedUserId =
      trimmedClientUserId && trimmedClientUserId !== deviceFingerprint ? trimmedClientUserId : "";

    // Use device fingerprint as the primary user_id for session tracking
    const userId = deviceFingerprint;

    // Get or create a session ID from the sessions service
    const { sessionId } = await sessionsService.updateSession({
      userId,
      siteId,
    });

    // Check if R2 storage is enabled for cloud deployments
    let r2BatchKey: string | null = null;
    let eventDataArray: any[] = [];

    if (r2Storage.isEnabled()) {
      // Extract event data for R2 storage
      eventDataArray = events.map(event => event.data);

      try {
        // Store event data batch in R2
        r2BatchKey = await r2Storage.storeBatch(siteId, sessionId, eventDataArray);
      } catch (error) {
        console.error("Failed to store in R2, falling back to ClickHouse:", error);
        r2BatchKey = null;
      }
    }

    // Prepare events for batch insert
    const eventsToInsert = events.map((event, index) => {
      const serializedData = JSON.stringify(event.data);

      if (r2BatchKey) {
        // R2 storage: store metadata only in ClickHouse
        return {
          site_id: siteId,
          session_id: sessionId,
          user_id: userId,
          identified_user_id: identifiedUserId,
          timestamp: event.timestamp,
          event_type: event.type,
          event_data: "", // Empty string when using R2
          event_data_key: r2BatchKey,
          batch_index: index,
          sequence_number: index,
          event_size_bytes: serializedData.length,
          viewport_width: metadata?.viewportWidth || null,
          viewport_height: metadata?.viewportHeight || null,
          is_complete: 0,
        };
      } else {
        // Traditional storage: store everything in ClickHouse
        return {
          site_id: siteId,
          session_id: sessionId,
          user_id: userId,
          identified_user_id: identifiedUserId,
          timestamp: event.timestamp,
          event_type: event.type,
          event_data: serializedData,
          event_data_key: null,
          batch_index: null,
          sequence_number: index,
          event_size_bytes: serializedData.length,
          viewport_width: metadata?.viewportWidth || null,
          viewport_height: metadata?.viewportHeight || null,
          is_complete: 0,
        };
      }
    });

    // Batch insert events
    if (eventsToInsert.length > 0) {
      await clickhouse.insert({
        table: "session_replay_events",
        values: eventsToInsert,
        format: "JSONEachRow",
      });
    }

    // Extract click events for heatmap data
    this.extractAndInsertClicks(siteId, sessionId, events, metadata);

    // Update or insert metadata
    if (metadata) {
      await this.updateSessionMetadata(siteId, sessionId, userId, identifiedUserId, metadata, requestMeta);
    }
  }

  private async extractAndInsertClicks(
    siteId: number,
    sessionId: string,
    events: Array<{ type: string | number; data: any; timestamp: number }>,
    metadata?: { pageUrl?: string; viewportWidth?: number; viewportHeight?: number }
  ): Promise<void> {
    try {
      let pathname = "/";
      try {
        if (metadata?.pageUrl) {
          pathname = new URL(metadata.pageUrl).pathname;
        }
      } catch {}

      const viewportWidth = metadata?.viewportWidth || 0;
      const viewportHeight = metadata?.viewportHeight || 0;
      const deviceType = viewportWidth >= 1024 ? "desktop" : viewportWidth >= 768 ? "tablet" : "mobile";

      // --- Build / retrieve the selector map for this session ---
      // If this batch contains a FullSnapshot (type 2), parse it and cache it.
      for (const event of events) {
        const eventType = typeof event.type === "string" ? parseInt(event.type as string) : event.type;
        if (eventType === 2 && event.data?.node) {
          const selectorMap = buildSelectorMap(event.data.node);
          snapshotSelectorCache.set(sessionId, { map: selectorMap, ts: Date.now() });
          pruneSnapshotCache();
          break;
        }
      }

      const selectorMap = snapshotSelectorCache.get(sessionId)?.map;

      // Track scroll state from scroll events in this batch
      let scrollX = 0;
      let scrollY = 0;

      const clicksToInsert: any[] = [];

      for (const event of events) {
        const eventType = typeof event.type === "string" ? parseInt(event.type as string) : event.type;

        // Only process IncrementalSnapshot events (type 3)
        if (eventType !== 3 || !event.data) continue;

        const source = event.data.source;

        // Track scroll events (source 3 = Scroll)
        if (source === 3) {
          scrollX = event.data.x || 0;
          scrollY = event.data.y || 0;
          continue;
        }

        // Extract click events (source 2 = MouseInteraction, type 2 = Click, type 4 = DblClick)
        if (source === 2 && (event.data.type === 2 || event.data.type === 4)) {
          const nodeId: number | undefined = event.data.id;
          const selector = nodeId !== undefined && selectorMap ? (selectorMap.get(nodeId) ?? "") : "";

          clicksToInsert.push({
            site_id: siteId,
            session_id: sessionId,
            timestamp: event.timestamp,
            pathname,
            selector,
            x: event.data.x || 0,
            y: event.data.y || 0,
            scroll_x: scrollX,
            scroll_y: scrollY,
            viewport_width: viewportWidth,
            viewport_height: viewportHeight,
            device_type: deviceType,
          });
        }
      }

      if (clicksToInsert.length > 0) {
        await clickhouse.insert({
          table: "heatmap_clicks",
          values: clicksToInsert,
          format: "JSONEachRow",
        });
      }
    } catch (error) {
      // Don't fail the main ingest if heatmap extraction fails
      console.error("Error extracting heatmap clicks:", error);
    }
  }

  private async updateSessionMetadata(
    siteId: number,
    sessionId: string,
    userId: string,
    identifiedUserId: string,
    metadata: any,
    requestMeta?: RequestMetadata
  ): Promise<void> {
    // Get existing session info from events table
    const sessionInfo = await clickhouse.query({
      query: `
        SELECT 
          MIN(timestamp) as start_time,
          MAX(timestamp) as end_time,
          COUNT() as event_count,
          SUM(event_size_bytes) as compressed_size_bytes,
          MAX(viewport_width) as screen_width,
          MAX(viewport_height) as screen_height
        FROM session_replay_events
        WHERE site_id = {siteId:UInt16} 
          AND session_id = {sessionId:String}
      `,
      query_params: { siteId, sessionId },
      format: "JSONEachRow",
    });

    type SessionInfoResult = {
      start_time: string;
      end_time: string | null;
      event_count: number;
      compressed_size_bytes: number;
      screen_width: number | null;
      screen_height: number | null;
    };

    const sessionResults = await processResults<SessionInfoResult>(sessionInfo);

    if (!sessionResults || sessionResults.length === 0) return;

    const sessionReplayData = sessionResults[0];

    // Parse tracking data from request metadata
    let trackingData: any = {};
    if (requestMeta?.userAgent) {
      try {
        // Extract hostname from the page URL
        const urlObj = new URL(metadata.pageUrl);
        const hostname = urlObj.hostname;

        trackingData = await parseTrackingData(
          requestMeta.userAgent,
          requestMeta.ipAddress,
          requestMeta.referrer || "",
          urlObj.search || "", // querystring from URL
          hostname,
          metadata.language || "", // language from client
          sessionReplayData.screen_width || metadata.viewportWidth || 0,
          sessionReplayData.screen_height || metadata.viewportHeight || 0
        );
      } catch (error) {
        console.error("Error parsing tracking data for session replay:", error);
      }
    }

    // Calculate duration
    const startTime = new Date(sessionReplayData.start_time);
    const endTime = sessionReplayData.end_time ? new Date(sessionReplayData.end_time) : null;
    const durationMs = endTime ? endTime.getTime() - startTime.getTime() : null;

    // Insert or update metadata
    await clickhouse.insert({
      table: "session_replay_metadata",
      values: [
        {
          site_id: siteId,
          session_id: sessionId,
          user_id: userId,
          identified_user_id: identifiedUserId,
          start_time: DateTime.fromJSDate(startTime).toFormat("yyyy-MM-dd HH:mm:ss"),
          end_time: endTime ? DateTime.fromJSDate(endTime).toFormat("yyyy-MM-dd HH:mm:ss") : null,
          duration_ms: durationMs,
          event_count: sessionReplayData.event_count || 0,
          compressed_size_bytes: sessionReplayData.compressed_size_bytes || 0,
          page_url: metadata.pageUrl || "",
          country: trackingData.country || "",
          region: trackingData.region || "",
          city: trackingData.city || "",
          lat: trackingData.lat || 0,
          lon: trackingData.lon || 0,
          browser: trackingData.browser || "",
          browser_version: trackingData.browserVersion || "",
          operating_system: trackingData.operatingSystem || "",
          operating_system_version: trackingData.operatingSystemVersion || "",
          language: trackingData.language || "",
          screen_width: sessionReplayData.screen_width || metadata?.viewportWidth || 0,
          screen_height: sessionReplayData.screen_height || metadata?.viewportHeight || 0,
          device_type: trackingData.deviceType || "",
          channel: trackingData.channel || "",
          hostname: trackingData.hostname || "",
          referrer: trackingData.referrer || "",
          has_replay_data: 1,
        },
      ],
      format: "JSONEachRow",
    });
  }
}
