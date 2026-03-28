import { NewsWatchDashboard } from "@/components/news-watch-dashboard";
import { redactDashboardDebug } from "@/lib/dashboard";
import { getDashboardPayload } from "@/lib/news/aggregate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home() {
  const initialData = redactDashboardDebug(await getDashboardPayload());

  return <NewsWatchDashboard initialData={initialData} />;
}
