import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { useGetSessionReplayEvents } from "@/api/analytics/hooks/sessionReplay/useGetSessionReplayEvents";
import {
  BrowserTooltipIcon,
  CountryFlagTooltipIcon,
  DeviceTypeTooltipIcon,
  OperatingSystemTooltipIcon,
} from "@/components/TooltipIcons/TooltipIcons";
import { useShallow } from "zustand/react/shallow";
import { useReplayStore } from "../replayStore";

// Extract pathname from full URL for display
function getDisplayPath(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + urlObj.pathname + urlObj.search + urlObj.hash;
  } catch {
    return url;
  }
}

interface PageTransition {
  time: number;
  url: string;
}

export function ReplayPlayerTopbar() {
  const params = useParams();
  const siteId = Number(params.site);
  const { sessionId, currentTime } = useReplayStore(
    useShallow(s => ({ sessionId: s.sessionId, currentTime: s.currentTime }))
  );

  const { data } = useGetSessionReplayEvents(siteId, sessionId);

  const { metadata } = data ?? {};
  const screenDimensions = `${metadata?.screen_width} × ${metadata?.screen_height}`;

  // Pre-compute sorted page transitions for binary search
  const pageTransitions = useMemo((): PageTransition[] => {
    if (!data?.events) return [];

    const firstTimestamp = data.events[0]?.timestamp ?? 0;
    const transitions: PageTransition[] = [];

    for (const event of data.events) {
      if (event.type === 4 && event.data?.href) {
        transitions.push({
          time: event.timestamp - firstTimestamp,
          url: event.data.href,
        });
      }
    }

    return transitions;
  }, [data?.events]);

  // Binary search for current page URL
  const pageUrl = useMemo(() => {
    if (pageTransitions.length === 0 || currentTime === 0) {
      return metadata?.page_url;
    }

    // Binary search: find the last transition where time <= currentTime
    let lo = 0;
    let hi = pageTransitions.length - 1;
    let result = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (pageTransitions[mid].time <= currentTime) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return result >= 0 ? pageTransitions[result].url : metadata?.page_url;
  }, [pageTransitions, currentTime, metadata?.page_url]);

  if (!pageUrl || !metadata) {
    return (
      <div className="border border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-2 rounded-t-lg overflow-hidden">
        <div className="flex items-center justify-between min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="h-4 w-32 bg-neutral-150 dark:bg-neutral-700 rounded animate-pulse" />
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <div className="h-4 w-24 bg-neutral-150 dark:bg-neutral-700 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-2 rounded-t-lg overflow-hidden">
      <div className="flex items-center justify-between min-w-0">
        {/* Left side: Page path with external link */}
        <Link
          className="text-xs text-neutral-700 dark:text-neutral-300 truncate flex-1 min-w-0 flex items-center hover:underline"
          href={pageUrl}
          target="_blank"
          title={`Open ${pageUrl} in new tab`}
        >
          {getDisplayPath(pageUrl)}
        </Link>

        {/* Right side: Screen dimensions */}
        <div className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 shrink-0 ml-2">
          <CountryFlagTooltipIcon
            country={metadata.country}
            city={metadata.city}
            region={metadata.region}
            className="w-4 h-4"
          />
          <BrowserTooltipIcon browser={metadata.browser} browser_version={metadata.browser_version} size={13} />
          <OperatingSystemTooltipIcon
            operating_system={metadata.operating_system}
            operating_system_version={metadata.operating_system_version}
            size={13}
          />
          <DeviceTypeTooltipIcon
            device_type={metadata.device_type}
            screen_width={metadata.screen_width}
            screen_height={metadata.screen_height}
            size={16}
          />

          <span className="whitespace-nowrap">{screenDimensions}</span>
        </div>
      </div>
    </div>
  );
}
