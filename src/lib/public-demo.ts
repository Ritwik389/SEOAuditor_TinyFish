import { SettingsSchema } from "./config";
import { GeminiProvider } from "./gemini/provider";
import { defaultDeps, type Deps } from "./audit/orchestrator";

export const publicDemoEnabled = () => process.env.PUBLIC_DEMO_MODE === "true";
export const demoUser = { userId: "public-demo", email: "" };
export function publicServiceStatus() {
  return { tinyfish: !!process.env.TINYFISH_API_KEY?.trim(), gemini: !!process.env.GEMINI_API_KEY?.trim() };
}
export function publicSettings() {
  const parsed = SettingsSchema.safeParse({ geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash", maxEvidenceChars: 40000 });
  return parsed.success ? parsed.data : SettingsSchema.parse({ maxEvidenceChars: 40000 });
}
export function publicDeps(): Deps {
  return {
    ...defaultDeps,
    apiKey: async () => process.env.TINYFISH_API_KEY?.trim() || null,
    settings: async () => publicSettings(),
    provider: async () => process.env.GEMINI_API_KEY?.trim() ? new GeminiProvider(process.env.GEMINI_API_KEY.trim(), publicSettings().geminiModel) : null,
  };
}
