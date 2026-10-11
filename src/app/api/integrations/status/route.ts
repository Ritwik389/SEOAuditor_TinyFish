import { route } from "@/lib/api";
import { integrationsStatus } from "@/lib/integrations";

export const dynamic = "force-dynamic";
export const GET = route({}, async ({ user }) => integrationsStatus(user.userId));
