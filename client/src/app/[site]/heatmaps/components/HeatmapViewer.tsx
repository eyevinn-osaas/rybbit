"use client";

import { useMeasure } from "@uidotdev/usehooks";
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

/**
 * Resolve each click to a canvas coordinate using element-based positioning:
 * 1. Find the element by CSS selector in the snapshot iframe
 * 2. Scale the click's pageX from its original viewport to the snapshot width
 *    to approximate horizontal offset within the element
 * 3. Use element's vertical center (Y within a clickable element is negligible)
 */
function resolveClickPositions(
  clicks: HeatmapClick[],
  iframeDoc: Document,
  snapshotWidth: number
): { x: number; y: number }[] {
  // Cache element lookups
  const rectCache = new Map<string, DOMRect | null>();
  const getRect = (selector: string): DOMRect | null => {
    if (rectCache.has(selector)) return rectCache.get(selector)!;
    try {
      const el = iframeDoc.querySelector(selector);
      const rect = el ? el.getBoundingClientRect() : null;
      rectCache.set(selector, rect);
      return rect;
    } catch {
      rectCache.set(selector, null);
      return null;
    }
  };

  const points: { x: number; y: number }[] = [];

  for (const click of clicks) {
    const rect = getRect(click.selector);
    if (!rect || (rect.width === 0 && rect.height === 0)) continue;

    // Scale the click's absolute X from its viewport to the snapshot width
    const pageX = click.x + click.scroll_x;
    const scaledX = pageX * (snapshotWidth / click.viewport_width);

    // Compute offset within the element
    const offsetX = scaledX - rect.left;

    // Clamp X to element bounds (with small padding to avoid edge artifacts)
    const pad = 4;
    const clampedX = Math.max(-pad, Math.min(offsetX, rect.width + pad));

    // Use element's vertical center — clickable elements are typically short
    const dotX = rect.left + clampedX;
    const dotY = rect.top + rect.height / 2;

    points.push({ x: dotX, y: dotY });
  }

  return points;
}

function renderHeatmapCanvas(
  canvas: HTMLCanvasElement,
  points: { x: number; y: number }[]
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !points.length) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const radius = 25;

  // Draw additive grayscale blobs
  for (const pt of points) {
    const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, radius);
    grad.addColorStop(0, "rgba(0,0,0,0.07)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Colorize accumulated alpha → heatmap colours
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > 0) {
      const intensity = Math.min(a / 100, 1);
      const [r, g, b] = getHeatmapColor(intensity);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = Math.min(Math.round(intensity * 200) + 30, 210);
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export function HeatmapViewer({ pathname, onBack }: HeatmapViewerProps) {
  const t = useExtracted();
  const [deviceType, setDeviceType] = useState<"desktop" | "mobile">("desktop");
  const [measureRef, { width: containerWidth }] = useMeasure();
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<any>(null);
  const [contentHeight, setContentHeight] = useState(0);

  const { data: snapshotData, isLoading: isSnapshotLoading } = useGetHeatmapSnapshot(pathname, deviceType);
  const { data: clicks, isLoading: isClicksLoading } = useGetHeatmapClicks(pathname);

  const isLoading = isSnapshotLoading || isClicksLoading;

  const nativeWidth = deviceType === "mobile" ? 375 : snapshotData?.metadata?.screen_width || 1280;
  const nativeViewportHeight = snapshotData?.metadata?.screen_height || 800;
  const cssScale = containerWidth ? Math.min(containerWidth / nativeWidth, 1) : 1;

  const expandIframeToFullHeight = useCallback(() => {
    if (!playerContainerRef.current) return;
    const iframe = playerContainerRef.current.querySelector("iframe");
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const fullHeight = doc.documentElement.scrollHeight;
      if (fullHeight <= 0) return;

      iframe.style.height = `${fullHeight}px`;
      const frameEl = playerContainerRef.current.querySelector(".rr-player__frame") as HTMLElement;
      if (frameEl) frameEl.style.height = `${fullHeight}px`;
      const playerEl = playerContainerRef.current.querySelector(".rr-player") as HTMLElement;
      if (playerEl) playerEl.style.height = `${fullHeight}px`;

      setContentHeight(fullHeight);
    } catch {
      // cross-origin
    }
  }, []);

  const renderHeatmap = useCallback(
    (clickData: HeatmapClick[]) => {
      if (!playerContainerRef.current || !canvasRef.current || !clickData.length) return;

      const iframe = playerContainerRef.current.querySelector("iframe");
      if (!iframe?.contentDocument) return;

      const fullHeight = contentHeight || nativeViewportHeight;
      const canvas = canvasRef.current;
      canvas.width = nativeWidth;
      canvas.height = fullHeight;
      canvas.style.width = `${nativeWidth}px`;
      canvas.style.height = `${fullHeight}px`;

      const points = resolveClickPositions(clickData, iframe.contentDocument, nativeWidth);
      renderHeatmapCanvas(canvas, points);
    },
    [nativeWidth, nativeViewportHeight, contentHeight]
  );

  // Initialize rrweb replayer
  useEffect(() => {
    if (!snapshotData?.events?.length || !playerContainerRef.current) return;

    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current = null;
    }
    playerContainerRef.current.innerHTML = "";
    setContentHeight(0);

    const initPlayer = async () => {
      try {
        const rrwebModule = await import("rrweb-player");
        const player = new rrwebModule.default({
          target: playerContainerRef.current!,
          props: {
            events: snapshotData.events as any,
            width: nativeWidth,
            height: nativeViewportHeight,
            autoPlay: false,
            showController: false,
            mouseTail: false,
          },
        });
        playerRef.current = player;

        const settle = () => {
          expandIframeToFullHeight();
          if (clicks?.length) renderHeatmap(clicks);
        };
        setTimeout(settle, 300);
        setTimeout(settle, 800);
        setTimeout(settle, 1500);
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
  }, [snapshotData, deviceType, nativeWidth, nativeViewportHeight, expandIframeToFullHeight, clicks, renderHeatmap]);

  useEffect(() => {
    if (clicks?.length && playerRef.current) {
      const timer = setTimeout(() => renderHeatmap(clicks), 600);
      return () => clearTimeout(timer);
    }
  }, [clicks, contentHeight, renderHeatmap]);

  const nativeHeight = contentHeight || nativeViewportHeight;
  const totalClicks = clicks?.length ?? 0;

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
        <div
          ref={measureRef}
          className="flex-1 overflow-auto border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white"
        >
          <div
            style={{
              width: nativeWidth * cssScale,
              height: nativeHeight * cssScale,
              margin: deviceType === "mobile" ? "0 auto" : undefined,
            }}
          >
            <div
              style={{
                width: nativeWidth,
                height: nativeHeight,
                transform: `scale(${cssScale})`,
                transformOrigin: "top left",
              }}
              className="relative"
            >
              <div
                ref={playerContainerRef}
                className="[&_.rr-player]:!shadow-none [&_.rr-player__frame]:!border-none"
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 pointer-events-none"
                style={{ zIndex: 10 }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      {totalClicks > 0 && (
        <div className="text-sm text-neutral-500 flex-shrink-0">
          {totalClicks.toLocaleString()} {t("clicks")}
        </div>
      )}
    </div>
  );
}
