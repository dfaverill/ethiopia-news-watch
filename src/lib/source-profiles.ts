import type { SourceName } from "@/lib/dashboard";

export interface SourceProfile {
  source: SourceName;
  officialUrl: string;
  typeLabel: string;
  languagesLabel: string;
  popularityLabel: string;
  coreCoverageLabel: string;
  overview: string;
  influence: string;
  whyTracked: string;
}

export const SOURCE_PROFILES: Record<SourceName, SourceProfile> = {
  "Addis Standard": {
    source: "Addis Standard",
    officialUrl: "https://addisstandard.com/",
    typeLabel: "Independent multilingual outlet",
    languagesLabel: "English, Amharic, Afaan Oromoo",
    popularityLabel: "Influential in Ethiopia and closely watched by diaspora and international Ethiopia observers",
    coreCoverageLabel: "Politics, conflict, accountability, public-interest reporting",
    overview:
      "Addis Standard is an independent Ethiopian outlet founded in 2011. It publishes public-interest reporting with a strong focus on politics, state institutions, conflict, rights, and the kinds of stories readers usually seek out when they want something less official or less promotional than state-aligned coverage.",
    influence:
      "Its impact is bigger than a raw traffic number would suggest because independent media space in Ethiopia is tight. That means Addis Standard often matters both inside Ethiopia and abroad: inside the country for readers who want a more critical lens, and outside the country for diaspora readers, diplomats, researchers, and press-freedom watchers who follow Ethiopia closely.",
    whyTracked:
      "In this app, we watch Addis Standard because it often contributes an independent angle, multilingual reporting, and more skeptical framing than official or institutional outlets. It is one of the most useful sources here when a story involves political tension, contested narratives, or accountability questions.",
  },
  "The Reporter Ethiopia": {
    source: "The Reporter Ethiopia",
    officialUrl: "https://www.thereporterethiopia.com/",
    typeLabel: "Private bilingual news institution",
    languagesLabel: "English and Amharic",
    popularityLabel: "Strong domestic recognition, especially among politics, business, and urban public-affairs readers",
    coreCoverageLabel: "General news, politics, business, interviews, institutional reporting",
    overview:
      "The Reporter Ethiopia is a long-running private media institution that presents itself as an independent, multi-platform news organization. Its coverage feels closer to a classic newspaper model than a niche analysis site: broad headline coverage, business and political reporting, interviews, and a steady focus on official and public-life developments.",
    influence:
      "Its strongest influence is inside Ethiopia because of its long-running bilingual presence and its role as one of the most established private news brands in the country. It is also useful abroad for investors, researchers, and diaspora readers who want a mainstream Ethiopian newspaper lens rather than an explicitly international or state-wire view.",
    whyTracked:
      "In this app, we watch The Reporter because it is often a good baseline source for how major Ethiopian stories are being framed in a well-known private outlet. It helps balance the feed between official messaging, independent reporting, and more analysis-driven publications.",
  },
  "Ethiopia Insight": {
    source: "Ethiopia Insight",
    officialUrl: "https://www.ethiopia-insight.com/",
    typeLabel: "Independent analysis publication",
    languagesLabel: "English",
    popularityLabel: "Most influential among readers who want depth: researchers, policy readers, journalists, and diaspora audiences",
    coreCoverageLabel: "News analysis, in-depth reporting, commentary, context",
    overview:
      "Ethiopia Insight is not built like a high-volume breaking-news site. It is an independent publication centered on news analysis, in-depth reporting, and edited commentary on Ethiopian political and economic issues, especially topics it says are under-reported elsewhere.",
    influence:
      "Its audience is usually more specialized than mass-market news brands, but its influence is outsized among people who need context rather than just headlines. That makes it especially valuable for readers in Ethiopia and abroad who want to understand why a development matters, what background they are missing, and where a debate is coming from.",
    whyTracked:
      "In this app, we watch Ethiopia Insight because it improves the quality of understanding around big stories. It often adds explanatory depth and strategic context that faster, more event-driven outlets do not spend as much time on.",
  },
  ENA: {
    source: "ENA",
    officialUrl: "https://www.ena.et/web/eng",
    typeLabel: "State news wire",
    languagesLabel: "Amharic, Afan Oromo, Tigrigna, English, Arabic, French",
    popularityLabel: "Strongest inside Ethiopia and among anyone tracking official Ethiopian positions",
    coreCoverageLabel: "Government activity, official statements, development, diplomacy, institutional announcements",
    overview:
      "ENA, the Ethiopian News Agency, is the country’s national wire service and one of the oldest media institutions in Ethiopia. Its role is not mainly to challenge official narratives; it is to gather and distribute news, statements, and institutional coverage at scale across multiple languages and branch offices.",
    influence:
      "Its influence is high because official Ethiopian positions often appear here first or spread quickly from here into other media. That makes ENA especially important inside Ethiopia, and also important abroad whenever embassies, investors, regional observers, or researchers need to know the government-facing version of a story.",
    whyTracked:
      "In this app, we watch ENA because it is one of the fastest ways to see what the Ethiopian state wants on record. Even when readers prefer more independent reporting overall, ENA remains essential for tracking official framing, diplomacy, and public announcements.",
  },
  NEBE: {
    source: "NEBE",
    officialUrl: "https://nebe.org.et/en",
    typeLabel: "Official election authority",
    languagesLabel: "Board notices, website updates, election communications",
    popularityLabel: "Most important in Ethiopia during election periods and for anyone following formal election rules",
    coreCoverageLabel: "Election administration, voter registration, party compliance, timelines, official notices",
    overview:
      "NEBE is not an independent newsroom. It is the National Election Board of Ethiopia, so what appears here is institutional election information rather than reported journalism. That matters because election stories can turn on official procedure, deadlines, code-of-conduct decisions, and formal board announcements.",
    influence:
      "Its importance rises sharply during election periods because it is the authoritative source for voter registration systems, administrative decisions, and board guidance to media and stakeholders. If someone is new to Ethiopian election coverage, this is the source that tells you what the election authority itself is saying and doing.",
    whyTracked:
      "In this app, we watch NEBE because official election administration can move the story even when it is not written like traditional news. It is one of the clearest ways to separate campaign rhetoric from actual procedural decisions.",
  },
  "VOA Amharic": {
    source: "VOA Amharic",
    officialUrl: "https://amharic.voanews.com/",
    typeLabel: "International broadcaster",
    languagesLabel: "Amharic service, within VOA's wider Horn of Africa coverage",
    popularityLabel: "Popular both inside Ethiopia and across diaspora audiences",
    coreCoverageLabel: "Breaking news, interviews, radio programs, international and regional perspective",
    overview:
      "VOA Amharic is the Amharic-language service of Voice of America, the U.S.-funded international broadcaster. It combines straight news, interviews, call-in style programming, diaspora-relevant coverage, and a broader international framing than most domestic Ethiopian outlets.",
    influence:
      "VOA says its Horn of Africa services reach more than 13 million people in Ethiopia and Eritrea across Amharic, Afaan Oromo, and Tigrinya, and that its 2018 survey showed weekly audience above 11 million in Ethiopia. That gives it real weight both inside the country and among diaspora audiences who want an external broadcaster rather than a domestic outlet.",
    whyTracked:
      "In this app, we watch VOA Amharic because it often adds a different editorial lens, stronger interview programming, and broader diaspora relevance. It is especially useful when you want to compare how a story is framed outside Ethiopia's domestic media environment.",
  },
};

export function getSourceProfile(source: SourceName) {
  return SOURCE_PROFILES[source];
}
