"use client";

import { useState } from "react";
import { DisabledOverlay } from "../../../components/DisabledOverlay";
import { useSetPageTitle } from "../../../hooks/useSetPageTitle";
import { SubHeader } from "../components/SubHeader/SubHeader";
import { HeatmapPageList } from "./components/HeatmapPageList";
import { HeatmapViewer } from "./components/HeatmapViewer";

export default function HeatmapsPage() {
  useSetPageTitle("Heatmaps");

  const [selectedPathname, setSelectedPathname] = useState<string | null>(null);

  return (
    <DisabledOverlay message="Heatmaps" featurePath="heatmaps" requiredPlan="pro">
      <div className="p-2 md:p-4 max-w-[2000px] mx-auto flex flex-col gap-3 h-[calc(100vh-60px)]">
        <SubHeader />
        {selectedPathname ? (
          <HeatmapViewer pathname={selectedPathname} onBack={() => setSelectedPathname(null)} />
        ) : (
          <HeatmapPageList onSelectPage={setSelectedPathname} />
        )}
      </div>
    </DisabledOverlay>
  );
}
