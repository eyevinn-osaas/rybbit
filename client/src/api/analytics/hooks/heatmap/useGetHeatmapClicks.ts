import { useQuery } from "@tanstack/react-query";
import { fetchHeatmapClicks } from "../../endpoints/heatmap";
import { buildApiParams } from "../../../utils";
import { useStore } from "../../../../lib/store";

export function useGetHeatmapClicks(pathname: string) {
  const { site, time, filters } = useStore();

  const params = buildApiParams(time, { filters });

  return useQuery({
    queryKey: ["heatmap-clicks", site, pathname, params],
    queryFn: () =>
      fetchHeatmapClicks(site!, {
        ...params,
        pathname,
      }),
    enabled: !!site && !!pathname,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}
