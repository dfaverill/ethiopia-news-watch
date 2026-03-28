import type { TopicName } from "@/lib/dashboard";

export const REQUEST_TIMEOUT_MS = 18_000;
export const REQUEST_RETRY_COUNT = 1;
export const REQUEST_RETRY_DELAY_MS = 1_200;
export const CACHE_TTL_MS = 10 * 60 * 1000;
export const PERSISTED_CACHE_SCHEMA_VERSION = 1;
export const MAX_ITEMS_PER_SOURCE = 10;
export const API_READ_RATE_LIMIT = 90;
export const API_READ_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const API_REFRESH_RATE_LIMIT = 6;
export const API_REFRESH_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const FORCE_REFRESH_COOLDOWN_MS = 45 * 1000;

export const KEYWORD_WEIGHTS: Record<string, number> = {
  ethiopia: 9,
  ethiopian: 9,
  "addis ababa": 8,
  addis: 4,
  abiy: 7,
  tigray: 7,
  amhara: 7,
  oromia: 7,
  nebe: 9,
  election: 7,
  elections: 7,
  parliament: 5,
  federal: 4,
  regional: 3,
  eritrea: 6,
  sudan: 4,
  "sudan border": 7,
  "peace talks": 6,
  insurgency: 6,
  displacement: 6,
  humanitarian: 6,
  cabinet: 5,
  "ruling party": 6,
  opposition: 5,
  dialogue: 4,
  mekelle: 6,
  somaliland: 5,
  border: 3,
  voter: 4,
  ballot: 4,
  campaign: 4,
  refugees: 4,
  refugee: 4,
  aid: 4,
};

export const ETHIOPIA_ANCHOR_KEYWORDS = new Set([
  "ethiopia",
  "ethiopian",
  "addis ababa",
  "abiy",
  "tigray",
  "amhara",
  "oromia",
  "nebe",
  "mekelle",
  "eritrea",
  "somaliland",
  "sudan border",
]);

export const SOURCE_CONTEXT_ALLOWLIST = new Set([
  "Addis Standard",
  "The Reporter Ethiopia",
  "Ethiopia Insight",
  "ENA",
  "NEBE",
  "VOA Amharic",
]);

export const TOPIC_KEYWORDS: Record<TopicName, string[]> = {
  Politics: [
    "parliament",
    "cabinet",
    "federal",
    "regional",
    "opposition",
    "dialogue",
    "prime minister",
    "ruling party",
    "government",
  ],
  Election: [
    "election",
    "elections",
    "nebe",
    "ballot",
    "voter",
    "candidate",
    "campaign",
    "political parties",
  ],
  Conflict: [
    "tigray",
    "amhara",
    "oromia",
    "insurgency",
    "clash",
    "clashes",
    "conflict",
    "war",
    "killed",
    "security issues",
    "disputed territories",
  ],
  Diplomacy: [
    "eritrea",
    "sudan",
    "border",
    "summit",
    "diplomatic",
    "foreign minister",
    "peace talks",
    "tripartite",
    "wto",
  ],
  Economy: [
    "investment",
    "economy",
    "trade",
    "market",
    "inflation",
    "fuel",
    "wto",
    "forum",
    "power project",
  ],
  Humanitarian: [
    "humanitarian",
    "displacement",
    "returnees",
    "refugee",
    "refugees",
    "aid",
    "food",
    "relief",
    "school feeding",
  ],
};

export const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "amid",
  "into",
  "from",
  "says",
  "say",
  "news",
  "ethiopia",
  "ethiopian",
  "addis",
  "ababa",
  "report",
  "reports",
  "analysis",
  "update",
  "latest",
]);
