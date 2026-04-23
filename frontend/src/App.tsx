import { useEffect, useState } from "react";

import { fetchMetadata, type Metadata } from "./lib/api";
import { ContoursOnlyTab } from "./components/ContoursOnlyTab";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Footer } from "./components/Footer";
import { IndividualTrajectoriesTab } from "./components/IndividualTrajectoriesTab";
import { LeftRail } from "./components/LeftRail";
import { OverallTrajectoriesTab } from "./components/OverallTrajectoriesTab";
import { RawContoursTab } from "./components/RawContoursTab";
import { RightRail } from "./components/RightRail";
import { TabNav } from "./components/TabNav";
import { useUi } from "./store/ui";

export default function App() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tab = useUi((s) => s.tab);

  useEffect(() => {
    fetchMetadata()
      .then(setMetadata)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (err) {
    return (
      <div className="m-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load metadata: {err}
        <br />
        <span className="text-xs text-red-500">
          Is the backend running on http://127.0.0.1:8765?
        </span>
      </div>
    );
  }
  if (!metadata) {
    return <div className="p-6 text-sm text-slate-500">Loading metadata…</div>;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-slate-800">
      <LeftRail metadata={metadata} />
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h1 className="text-base font-semibold text-slate-800">
            Ka Leo Hawaiʻi Vowel Visualizer
          </h1>
          <span className="text-xs text-slate-400">
            {metadata.speakers.length} speakers · {metadata.vowels.length} vowels
          </span>
        </header>
        <TabNav />
        <div className="flex-1 overflow-auto">
          <ErrorBoundary>
            {tab === "overall" && <OverallTrajectoriesTab />}
            {tab === "individual" && <IndividualTrajectoriesTab />}
            {tab === "raw_contours" && <RawContoursTab />}
            {tab === "contours_only" && <ContoursOnlyTab />}
          </ErrorBoundary>
        </div>
        <Footer />
      </main>
      <RightRail />
    </div>
  );
}
