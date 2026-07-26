import { auth } from "../../../auth.js";
import { removeDemoSettings } from "../../lib/demoSettings.js";

export const dynamic = "force-dynamic";

const demoCookieName = "munetios_demo";

function demoCookie(value, maximumAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `${demoCookieName}=${encodeURIComponent(value)}; Path=/; Max-Age=${maximumAge}; SameSite=Lax${secure}`;
}

function jsonResponse(payload, cookie) {
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": cookie,
    },
  });
}

export async function POST() {
  const demoId = crypto.randomUUID();

  return jsonResponse(
    {
      demo: true,
      demoId,
    },
    demoCookie(demoId, 7200),
  );
}

export async function DELETE(request) {
  const session = await auth(request);

  if (session?.demo) {
    globalThis.__munetiosWorkspaceStore?.delete(session.sessionKey);
    globalThis.__munetiosAccountProfileStore?.delete(session.user.id);
    globalThis.__munetiosLanguagePreferenceStore?.delete(session.user.id);
    removeDemoSettings(session);
  }

  return jsonResponse(
    {
      demo: false,
    },
    demoCookie("", 0),
  );
}
