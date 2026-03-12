"use client";

import { MousePointerClick, Search } from "lucide-react";
import { useExtracted } from "next-intl";
import { useState } from "react";
import { useGetHeatmapPages } from "../../../../api/analytics/hooks/heatmap/useGetHeatmapPages";
import { NothingFound } from "../../../../components/NothingFound";
import { Input } from "../../../../components/ui/input";

interface HeatmapPageListProps {
  onSelectPage: (pathname: string) => void;
}

export function HeatmapPageList({ onSelectPage }: HeatmapPageListProps) {
  const t = useExtracted();
  const { data: pages, isLoading } = useGetHeatmapPages();
  const [search, setSearch] = useState("");

  const filteredPages = pages?.filter((page) => page.pathname.toLowerCase().includes(search.toLowerCase())) ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" />
      </div>
    );
  }

  if (!pages?.length) {
    return (
      <NothingFound
        icon={<MousePointerClick className="w-10 h-10" />}
        title={t("No heatmap data found")}
        description={t("Select a page to view its heatmap")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
        <Input
          placeholder={t("Search pages...")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
              <th className="text-left p-3 font-medium text-neutral-600 dark:text-neutral-400">
                {t("Page")}
              </th>
              <th className="text-right p-3 font-medium text-neutral-600 dark:text-neutral-400 w-28">
                {t("clicks")}
              </th>
              <th className="text-right p-3 font-medium text-neutral-600 dark:text-neutral-400 w-36">
                {t("unique sessions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredPages.map((page) => (
              <tr
                key={page.pathname}
                onClick={() => onSelectPage(page.pathname)}
                className="border-b last:border-b-0 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 cursor-pointer transition-colors"
              >
                <td className="p-3 font-mono text-xs truncate max-w-[500px]">{page.pathname}</td>
                <td className="p-3 text-right tabular-nums">{page.click_count.toLocaleString()}</td>
                <td className="p-3 text-right tabular-nums">{page.unique_sessions.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
