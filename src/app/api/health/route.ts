import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const projectRoot = process.cwd();
  const normalizedRoot = projectRoot.replace(/[\\/]+$/, "");
  const pathParts = normalizedRoot.split(/[\\/]+/);

  return NextResponse.json(
    {
      ok: true,
      service: "ethiopia-news-watch",
      projectRoot,
      projectName: pathParts[pathParts.length - 1] ?? "unknown-project",
      mode: process.env.NODE_ENV ?? "unknown",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
