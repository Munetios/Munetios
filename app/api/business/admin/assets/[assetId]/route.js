import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const assetDirectory = resolve(
  process.env.MUNETIOS_DATA_DIR || join(process.cwd(), "data"),
  "business-signin-assets",
);

export async function GET(_request, { params }) {
  const { assetId } = await params;
  if (!/^[\da-f-]{36}$/i.test(assetId || "")) {
    return Response.json({ error: "asset_not_found" }, { status: 404 });
  }
  const filePath = resolve(assetDirectory, assetId);
  const expectedPrefix = `${assetDirectory}${process.platform === "win32" ? "\\" : "/"}`;
  if (!filePath.startsWith(expectedPrefix)) {
    return Response.json({ error: "asset_not_found" }, { status: 404 });
  }
  try {
    const [metadata, fileStats] = await Promise.all([
      readFile(`${filePath}.json`, "utf8").then(JSON.parse),
      stat(filePath),
    ]);
    return new Response(Readable.toWeb(createReadStream(filePath)), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(fileStats.size),
        "Content-Type": metadata.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "asset_not_found" }, { status: 404 });
  }
}
