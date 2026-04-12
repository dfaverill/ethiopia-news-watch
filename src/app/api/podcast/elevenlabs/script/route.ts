import { readFile } from "node:fs/promises";

import { NextRequest, NextResponse } from "next/server";

import { getElevenLabsRecentScriptPath } from "@/lib/elevenlabs-podcast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const scriptPath = await getElevenLabsRecentScriptPath();

  if (!scriptPath) {
    return NextResponse.json(
      { error: "No scripted last-two-days report is available yet." },
      {
        status: 404,
      },
    );
  }

  const wantsDownload = request.nextUrl.searchParams.get("download") === "1";
  const markdown = await readFile(scriptPath, "utf8");

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "text/markdown; charset=utf-8",
      ...(wantsDownload
        ? {
            "Content-Disposition":
              'attachment; filename="ethiopia-news-watch-last-two-days-script.md"',
          }
        : {}),
    },
  });
}
