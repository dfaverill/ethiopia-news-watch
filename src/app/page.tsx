import { NewsWatchDashboard } from "@/components/news-watch-dashboard";
import { normalizeBackgroundTheme } from "@/lib/background-themes";
import {
  normalizeDashboardFilters,
  redactDashboardDebug,
} from "@/lib/dashboard";
import { getDashboardPayload } from "@/lib/news/aggregate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  const resolvedSearchParams = await searchParams;
  const initialData = redactDashboardDebug(await getDashboardPayload());
  const initialFilters = normalizeDashboardFilters(resolvedSearchParams);
  const backgroundTheme = normalizeBackgroundTheme(
    resolvedSearchParams.bgPreview,
  );

  return (
    <NewsWatchDashboard
      initialData={initialData}
      initialFilters={initialFilters}
      backgroundTheme={backgroundTheme}
    />
  );
}
