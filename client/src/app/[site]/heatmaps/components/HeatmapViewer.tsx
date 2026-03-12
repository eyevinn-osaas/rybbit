"use client";

import { ArrowLeft, Loader2, Monitor, Smartphone } from "lucide-react";
import { useExtracted } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGetHeatmapClicks } from "../../../../api/analytics/hooks/heatmap/useGetHeatmapClicks";
import { useGetHeatmapSnapshot } from "../../../../api/analytics/hooks/heatmap/useGetHeatmapSnapshot";
import { HeatmapClick } from "../../../../api/analytics/endpoints/heatmap";
import { Button } from "../../../../components/ui/button";
import { cn } from "../../../../lib/utils";

interface HeatmapViewerProps {
  pathname: string;
  onBack: () => void;
}

function getHeatmapColor(intensity: number): [number, number, number] {
  // blue -> cyan -> green -> yellow -> red
  if (intensity < 0.25) {
    const t = intensity / 0.25;
    return [0, Math.round(t * 255), 255];
  } else if (intensity < 0.5) {
    const t = (intensity - 0.25) / 0.25;
    return [0, 255, Math.round(255 * (1 - t))];
  } else if (intensity < 0.75) {
    const t = (intensity - 0.5) / 0.25;
    return [Math.round(t * 255), 255, 0];
  } else {
    const t = (intensity - 0.75) / 0.25;
    return [255, Math.round(255 * (1 - t)), 0];
  }
}

function renderHeatmap(canvas: HTMLCanvasElement, clicks: HeatmapClick[], scale: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const radius = 25 * scale;

  // Draw intensity (grayscale)
  for (const click of clicks) {
    const pageX = click.x + click.scroll_x;
    const pageY = click.y + click.scroll_y;
    const displayX = pageX * scale;
    const displayY = pageY * scale;

    const gradient = ctx.createRadialGradient(displayX, displayY, 0, displayX, displayY, radius);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.05)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(displayX, displayY, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Colorize the grayscale intensity map
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha > 0) {
      const intensity = Math.min(alpha / 80, 1);
      const [r, g, b] = getHeatmapColor(intensity);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.min(Math.round(intensity * 180) + 40, 200);
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function HeatmapViewer({ pathname, onBack }: HeatmapViewerProps) {
  const t = useExtracted();
  const [deviceType, setDeviceType] = useState<"desktop" | "mobile">("desktop");
  const containerRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<any>(null);

  const { data: snapshotData, isLoading: isSnapshotLoading } = useGetHeatmapSnapshot(pathname, deviceType);
  const { data: clicks, isLoading: isClicksLoading } = useGetHeatmapClicks(pathname, deviceType);

  const isLoading = isSnapshotLoading || isClicksLoading;

  // Initialize the rrweb replayer when snapshot data arrives
  useEffect(() => {
    if (!snapshotData?.events?.length || !playerContainerRef.current) return;

    // Clear previous player
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current = null;
    }
    playerContainerRef.current.innerHTML = "";

    let rrwebPlayer: any;
    const initPlayer = async () => {
      try {
        const rrwebModule = await import("rrweb-player");
        rrwebPlayer = new rrwebModule.default({
          target: playerContainerRef.current!,
          props: {
            events: snapshotData.events as any,
            width: deviceType === "mobile" ? 375 : snapshotData.metadata?.screen_width || 1280,
            height: deviceType === "mobile" ? 667 : snapshotData.metadata?.screen_height || 800,
            autoPlay: false,
            showController: false,
            mouseTail: false,
          },
        });
        playerRef.current = rrwebPlayer;
      } catch (error) {
        console.error("Failed to initialize rrweb player:", error);
      }
    };

    initPlayer();

    return () => {
      if (playerRef.current) {
        playerRef.current.pause();
        playerRef.current = null;
      }
    };
  }, [snapshotData, deviceType]);

  // Render heatmap overlay when clicks data arrives
  const updateHeatmap = useCallback(() => {
    if (!canvasRef.current || !clicks?.length || !playerContainerRef.current) return;

    const replayerEl = playerContainerRef.current.querySelector(".rr-player__frame") as HTMLElement;
    if (!replayerEl) return;

    const replayerWidth = replayerEl.offsetWidth;
    const replayerHeight = replayerEl.offsetHeight;

    if (!replayerWidth || !replayerHeight) return;

    const canvas = canvasRef.current;
    // Use the original viewport width to calculate scale
    const originalWidth = deviceType === "mobile" ? 375 : snapshotData?.metadata?.screen_width || 1280;
    const scale = replayerWidth / originalWidth;

    // Size canvas to match the replayer frame content
    // Height needs to be large enough for absolute-positioned clicks
    const maxScrollY = Math.max(...clicks.map((c) => c.y + c.scroll_y), 0);
    const canvasHeight = Math.max(replayerHeight, (maxScrollY + 200) * scale);

    canvas.width = replayerWidth;
    canvas.height = canvasHeight;
    canvas.style.width = `${replayerWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    renderHeatmap(canvas, clicks, scale);
  }, [clicks, snapshotData, deviceType]);

  useEffect(() => {
    // Small delay to let the replayer render first
    const timer = setTimeout(updateHeatmap, 500);
    return () => clearTimeout(timer);
  }, [updateHeatmap]);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t("Back to pages")}
        </Button>
        <span className="font-mono text-sm text-neutral-600 dark:text-neutral-400 truncate flex-1">{pathname}</span>
        <div className="flex items-center border border-neutral-200 dark:border-neutral-800 rounded-md overflow-hidden">
          <button
            onClick={() => setDeviceType("desktop")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
              deviceType === "desktop"
                ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-white"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            )}
          >
            <Monitor className="w-4 h-4" />
            Desktop
          </button>
          <button
            onClick={() => setDeviceType("mobile")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
              deviceType === "mobile"
                ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-white"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            )}
          >
            <Smartphone className="w-4 h-4" />
            Mobile
          </button>
        </div>
      </div>

      {/* Viewer */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
        </div>
      ) : !snapshotData?.events?.length ? (
        <div className="flex-1 flex items-center justify-center text-neutral-500">
          {t("Unable to load page preview")}
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-auto border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white">
          <div className="relative mx-auto" style={{ width: deviceType === "mobile" ? 375 : "100%" }}>
            <div ref={playerContainerRef} className="[&_.rr-player]:!shadow-none [&_.rr-player__frame]:!border-none" />
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 pointer-events-none"
              style={{ zIndex: 10 }}
            />
          </div>
        </div>
      )}

      {/* Click count */}
      {clicks && clicks.length > 0 && (
        <div className="text-sm text-neutral-500 flex-shrink-0">
          {clicks.length.toLocaleString()} {t("clicks")}
        </div>
      )}
    </div>
  );
}
