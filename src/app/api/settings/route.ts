import { route } from "@/lib/api";
import { GEMINI_MODELS, SettingsPatchSchema, getSettings, updateSettings } from "@/lib/config";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ user }) => ({ settings: await getSettings(user.userId), geminiModels: GEMINI_MODELS }));

// Non-secret settings only; unknown keys are rejected so nothing sensitive can be written here.
export const PATCH = route({ rate: [20, 60_000], schema: SettingsPatchSchema }, async ({ user, body }) => ({ settings: await updateSettings(user.userId, body) }));
