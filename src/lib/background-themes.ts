export const BACKGROUND_THEME_OPTIONS = [
  {
    slug: "relief-briefing",
    name: "Ethiopia Relief Briefing Map",
    collection: "editorial",
    summary:
      "Ghosted Ethiopia map with contour energy and quiet newsroom blue signals.",
  },
  {
    slug: "quiet-relief",
    name: "Quiet Relief Map",
    collection: "editorial",
    summary:
      "A softer Ethiopia relief treatment with less glow and calmer contour detail.",
  },
  {
    slug: "redsea-accent",
    name: "Relief Map With Red Sea Accent",
    collection: "editorial",
    summary:
      "The Ethiopia relief look with a faint corridor glow toward the Red Sea.",
  },
  {
    slug: "highlands-editorial",
    name: "Editorial Highlands Texture",
    collection: "editorial",
    summary:
      "Minimal topographic texture with dark print-style depth and almost no map glow.",
  },
  {
    slug: "horn-signal",
    name: "Horn Signal Background",
    collection: "editorial",
    summary:
      "A subtle East Africa briefing wall with route lines, points, and restrained signal energy.",
  },
  {
    slug: "addis-dusk",
    name: "Addis Dusk Overlay",
    collection: "editorial",
    summary:
      "A blurred Addis city-light impression under a deep editorial dark wash.",
  },
  {
    slug: "satellite-night",
    name: "Satellite Night Ethiopia",
    collection: "creative",
    summary:
      "A near-orbital Ethiopia night view with faint city-light clusters and strategic glow.",
  },
  {
    slug: "archival-frontpage",
    name: "Archival Front Page",
    collection: "creative",
    summary:
      "Dark newsprint texture with ghosted column rules and subtle front-page structure.",
  },
  {
    slug: "tibeb-signal",
    name: "Tibeb Signal Weave",
    collection: "creative",
    summary:
      "A restrained Ethiopian woven-motif field fused with a quiet modern signal grid.",
  },
] as const;

export type BackgroundTheme = (typeof BACKGROUND_THEME_OPTIONS)[number]["slug"];

const BACKGROUND_THEME_SET = new Set<string>(
  BACKGROUND_THEME_OPTIONS.map((theme) => theme.slug),
);

export function normalizeBackgroundTheme(
  value: string | string[] | undefined,
): BackgroundTheme | null {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized || !BACKGROUND_THEME_SET.has(normalized)) {
    return null;
  }

  return normalized as BackgroundTheme;
}
