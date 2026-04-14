import type { LanguageLabel } from "@/lib/dashboard";
import type { VariantLanguage } from "@/lib/news/multilingual-dedupe";

export interface AddisStandardOfficialTelegramChannel {
  label: string;
  language: VariantLanguage;
  languageLabel: LanguageLabel;
  postUrlPrefix: string;
  previewUrl: string;
}

export interface AddisStandardOfficialFacebookPage {
  label: string;
  language: VariantLanguage;
  languageLabel: LanguageLabel;
  profileUrl: string;
}

export const ADDIS_STANDARD_OFFICIAL_FACEBOOK_PAGES = [
  {
    label: "Official Facebook page (English)",
    language: "english",
    languageLabel: "English",
    profileUrl: "https://www.facebook.com/AddisstandardEng",
  },
  {
    label: "Official Facebook page (Amharic)",
    language: "amharic",
    languageLabel: "Amharic",
    profileUrl: "https://www.facebook.com/AddisstandardAmh",
  },
  {
    label: "Official Facebook page (Afaan Oromoo)",
    language: "oromo",
    languageLabel: "Afaan Oromoo",
    profileUrl: "https://www.facebook.com/AddisstandardAO",
  },
] satisfies AddisStandardOfficialFacebookPage[];

export const ADDIS_STANDARD_OFFICIAL_TELEGRAM_CHANNELS = [
  {
    label: "Official Telegram channel (English)",
    language: "english",
    languageLabel: "English",
    postUrlPrefix: "https://t.me/AddisstandardEng/",
    previewUrl: "https://t.me/s/AddisstandardEng",
  },
  {
    label: "Official Telegram channel (Amharic)",
    language: "amharic",
    languageLabel: "Amharic",
    postUrlPrefix: "https://t.me/AddisstandardAmh/",
    previewUrl: "https://t.me/s/addisstandardamh",
  },
  {
    label: "Official Telegram channel (Afaan Oromoo)",
    language: "oromo",
    languageLabel: "Afaan Oromoo",
    postUrlPrefix: "https://t.me/AddisstandardAO/",
    previewUrl: "https://t.me/s/AddisstandardAO",
  },
] satisfies AddisStandardOfficialTelegramChannel[];
