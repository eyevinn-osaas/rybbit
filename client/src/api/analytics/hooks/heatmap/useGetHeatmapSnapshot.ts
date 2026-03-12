import { useQuery } from "@tanstack/react-query";
import { fetchHeatmapSnapshot } from "../../endpoints/heatmap";
import { useStore } from "../../../../lib/store";

export function useGetHeatmapSnapshot(pathname: string, deviceType?: string) {
  const { site } = useStore();

  return useQuery({
    queryKey: ["heatmap-snapshot", site, pathname, deviceType],
    queryFn: () => fetchHeatmapSnapshot(site!, pathname, deviceType),
    enabled: !!site && !!pathname,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });
}
