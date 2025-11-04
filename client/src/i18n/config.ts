import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Static resource imports (eager) for initial namespaces
import enCommon from "../locales/en/common.json";
import enNavigation from "../locales/en/navigation.json";
import enTickets from "../locales/en/tickets.json";
import enDashboard from "../locales/en/dashboard.json";
import enKnowledge from "../locales/en/knowledge.json";
import enBedrock from "../locales/en/bedrock.json";
import enDepartments from "../locales/en/departments.json";
import enTeams from "../locales/en/teams.json";
import esCommon from "../locales/es/common.json";
import esTickets from "../locales/es/tickets.json";
import esDashboard from "../locales/es/dashboard.json";
import esNavigation from "../locales/es/navigation.json";
import esKnowledge from "../locales/es/knowledge.json";
import esBedrock from "../locales/es/bedrock.json";
import esDepartments from "../locales/es/departments.json";
import esTeams from "../locales/es/teams.json";
import frCommon from "../locales/fr/common.json";
import frTickets from "../locales/fr/tickets.json";
import frDashboard from "../locales/fr/dashboard.json";
import frNavigation from "../locales/fr/navigation.json";
import frKnowledge from "../locales/fr/knowledge.json";
import deCommon from "../locales/de/common.json";
import deTickets from "../locales/de/tickets.json";
import deDashboard from "../locales/de/dashboard.json";
import deNavigation from "../locales/de/navigation.json";
import deKnowledge from "../locales/de/knowledge.json";
import zhCommon from "../locales/zh/common.json";
import zhTickets from "../locales/zh/tickets.json";
import zhDashboard from "../locales/zh/dashboard.json";
import zhNavigation from "../locales/zh/navigation.json";
import zhKnowledge from "../locales/zh/knowledge.json";

export const supportedLanguages = ["en", "es", "fr", "de", "zh"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const resources = {
  en: {
    common: enCommon,
    navigation: enNavigation,
    tickets: enTickets,
    dashboard: enDashboard,
    knowledge: enKnowledge,
    bedrock: enBedrock,
    departments: enDepartments,
    teams: enTeams,
  },
  es: {
    common: esCommon,
    navigation: esNavigation,
    tickets: esTickets,
    dashboard: esDashboard,
    knowledge: esKnowledge,
    bedrock: esBedrock,
    departments: esDepartments,
    teams: esTeams,
  },
  fr: {
    common: frCommon,
    navigation: frNavigation,
    tickets: frTickets,
    dashboard: frDashboard,
    knowledge: frKnowledge,
  },
  de: {
    common: deCommon,
    navigation: deNavigation,
    tickets: deTickets,
    dashboard: deDashboard,
    knowledge: deKnowledge,
  },
  zh: {
    common: zhCommon,
    navigation: zhNavigation,
    tickets: zhTickets,
    dashboard: zhDashboard,
    knowledge: zhKnowledge,
  },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: "en",
    fallbackLng: "en",
    ns: [
      "common",
      "navigation",
      "tickets",
      "dashboard",
      "knowledge",
      "bedrock",
      "departments",
      "teams",
    ],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
