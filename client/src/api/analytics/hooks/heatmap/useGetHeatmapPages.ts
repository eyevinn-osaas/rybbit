import { useQuery } from "@tanstack/react-query";
import { fetchHeatmapPages } from "../../endpoints/heatmap";
import { buildApiParams } from "../../../utils";
import { useStore } from "../../../../lib/store";

export function useGetHeatmapPages() {
  const { site, time, filters } = useStore();

  const params = buildApiParams(time, { filters });

  return useQuery({
    queryKey: ["heatmap-pages", site, params],
    queryFn: () => fetchHeatmapPages(site!, params),
    enabled: !!site,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}
