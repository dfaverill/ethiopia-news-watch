import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { resolvePodcastArchiveAudioRecord } from "@/lib/podcast-archive";

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

function resolveAudioMimeType(audioPath: string) {
  const extension = path.extname(audioPath).toLowerCase();

  switch (extension) {
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    default:
      return "audio/mpeg";
  }
}

function buildDownloadFileName(audioPath: string, jobKey: string) {
  const extension = path.extname(audioPath).toLowerCase() || ".mp3";
  return `ethiopia-news-watch-archive-${jobKey}${extension}`;
}

function buildHeaders(
  audioPath: string,
  contentLength: number,
  jobKey: string,
  contentRange?: string,
  download = false,
) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Length": String(contentLength),
    "Content-Type": resolveAudioMimeType(audioPath),
    ...(contentRange ? { "Content-Range": contentRange } : {}),
    ...(download
      ? {
          "Content-Disposition": `attachment; filename="${buildDownloadFileName(audioPath, jobKey)}"`,
        }
      : {}),
  };
}

export async function GET(request: NextRequest) {
  const provider =
    request.nextUrl.searchParams.get("provider") === "elevenlabs"
      ? "elevenlabs"
      : "google-notebooklm";
  const scope =
    request.nextUrl.searchParams.get("scope") === "recent" ? "recent" : "weekly";
  const jobKey = request.nextUrl.searchParams.get("jobKey");

  if (!jobKey) {
    return NextResponse.json(
      { error: "Missing archived podcast identifier." },
      { status: 400 },
    );
  }

  const record = await resolvePodcastArchiveAudioRecord({
    provider,
    scope,
    jobKey,
  });

  if (!record) {
    return NextResponse.json(
      { error: "Archived podcast audio was not found." },
      { status: 404 },
    );
  }

  const { size } = await stat(record.audioPath);
  const range = request.headers.get("range");
  const wantsDownload = request.nextUrl.searchParams.get("download") === "1";

  if (!range) {
    const stream = createReadStream(record.audioPath);

    return new NextResponse(toReadableStream(stream), {
      status: 200,
      headers: buildHeaders(
        record.audioPath,
        size,
        record.jobKey,
        undefined,
        wantsDownload,
      ),
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
  const stream = createReadStream(record.audioPath, {
    start,
    end,
  });

  return new NextResponse(toReadableStream(stream), {
    status: 206,
    headers: buildHeaders(
      record.audioPath,
      chunkSize,
      record.jobKey,
      `bytes ${start}-${end}/${size}`,
      wantsDownload,
    ),
  });
}
