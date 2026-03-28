import type { SourceAdapter } from "@/lib/news/types";
import { addisStandardAdapter } from "@/lib/news/sources/addis-standard";
import { enaAdapter } from "@/lib/news/sources/ena";
import { ethiopiaInsightAdapter } from "@/lib/news/sources/ethiopia-insight";
import { nebeAdapter } from "@/lib/news/sources/nebe";
import { reporterAdapter } from "@/lib/news/sources/the-reporter";
import { reutersAdapter } from "@/lib/news/sources/reuters";
import { voaAmharicAdapter } from "@/lib/news/sources/voa-amharic";

export const sourceAdapters: SourceAdapter[] = [
  reutersAdapter,
  addisStandardAdapter,
  reporterAdapter,
  ethiopiaInsightAdapter,
  enaAdapter,
  nebeAdapter,
  voaAmharicAdapter,
];
