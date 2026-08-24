import { requireAuth } from "../../../../auth.js";
import {
  importDataArchive,
  importGoogleTakeoutEntries,
} from "../../../lib/accountDataControls.js";
import { assertSameOrigin } from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (session.demo)
    return Response.json({ error: "signin_required" }, { status: 401 });
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    const contentType = request.headers.get("content-type") || "";
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      const form = await request.formData();
      const files = form.getAll("files");
      const paths = form.getAll("paths");
      if (
        !files.length ||
        files.length > 5000 ||
        paths.length !== files.length
      ) {
        throw new Error("invalid_takeout_folder");
      }
      let totalBytes = 0;
      const entries = new Map();
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (!file || typeof file.arrayBuffer !== "function") {
          throw new Error("invalid_takeout_file");
        }
        totalBytes += Number(file.size) || 0;
        if (totalBytes > 512 * 1024 * 1024) {
          throw new Error("invalid_import_size");
        }
        entries.set(String(paths[index] || file.name), {
          bytes: Buffer.from(await file.arrayBuffer()),
          contentType: String(file.type || ""),
        });
      }
      return Response.json(
        importGoogleTakeoutEntries(session.user.id, entries, { workspaceId }),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const bytes = await request.arrayBuffer();
    return Response.json(
      importDataArchive(session.user.id, bytes, { workspaceId }),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      { error: String(error?.message || "import_failed") },
      { headers: { "Cache-Control": "no-store" }, status: 400 },
    );
  }
}
