import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { NextRequest, NextResponse } from "next/server";

import { getElevenLabsRecentAudioPath } from "@/lib/elevenlabs-podcast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toReadableStream(stream: NodeJS.ReadableStream) {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    },
    cancel() {
      if ("destroy" in stream && typeof stream.destroy === "function") {
        stream.destroy();
      }
    },
  });
}

function buildHeaders(contentLength: number, contentRange?: string, download = false) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Length": String(contentLength),
    "Content-Type": "audio/mpeg",
    ...(contentRange ? { "Content-Range": contentRange } : {}),
    ...(download
      ? {
          "Content-Disposition":
            'attachment; filename="ethiopia-news-watch-last-two-days-elevenlabs.mp3"',
        }
      : {}),
  };
}

export async function GET(request: NextRequest) {
  const audioPath = await getElevenLabsRecentAudioPath();

  if (!audioPath) {
    return NextResponse.json(
      { error: "No ElevenLabs last-two-days audio overview is available yet." },
      {
        status: 404,
      },
    );
  }

  const { size } = await stat(audioPath);
  const range = request.headers.get("range");
  const wantsDownload = request.nextUrl.searchParams.get("download") === "1";

  if (!range) {
    const stream = createReadStream(audioPath);

    return new NextResponse(toReadableStream(stream), {
      status: 200,
      headers: buildHeaders(size, undefined, wantsDownload),
    });
  }

  const matchedRange = /bytes=(\d*)-(\d*)/.exec(range);
  if (!matchedRange) {
    return new NextResponse(null, { status: 416 });
  }

  const start = matchedRange[1] ? Number(matchedRange[1]) : 0;
  const end = matchedRange[2] ? Number(matchedRange[2]) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= size) {
    return new NextResponse(null, { status: 416 });
  }

  const chunkSize = end - start + 1;
  const stream = createReadStream(audioPath, {
    start,
    end,
  });

  return new NextResponse(toReadableStream(stream), {
    status: 206,
    headers: buildHeaders(
      chunkSize,
      `bytes ${start}-${end}/${size}`,
      wantsDownload,
    ),
  });
}
