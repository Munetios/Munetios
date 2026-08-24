import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { auth, unauthorizedResponse } from "../../../../auth.js";
import { assertSameOrigin } from "../../../lib/authSecurity.js";
import { dataDirectory } from "../../../lib/dataDirectory.js";
import { saveDurableConnectorIcon } from "../../../lib/durableAuthStore.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maximumBytes = 500 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const iconDirectory = resolve(dataDirectory, "connector-icons");

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session) return unauthorizedResponse();
  const contentType = request.headers.get("content-type")?.split(";")[0] || "";
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (
    !allowedTypes.has(contentType) ||
    !request.body ||
    contentLength > maximumBytes
  ) {
    return Response.json({ error: "invalid_icon" }, { status: 413 });
  }

  mkdirSync(iconDirectory, { recursive: true });
  const iconId = randomUUID();
  const filePath = resolve(iconDirectory, iconId);
  const expectedPrefix = `${iconDirectory}${process.platform === "win32" ? "\\" : "/"}`;
  if (!filePath.startsWith(expectedPrefix)) {
    return Response.json({ error: "invalid_path" }, { status: 400 });
  }

  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maximumBytes) {
        callback(new Error("icon_too_large"));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body),
      limiter,
      createWriteStream(filePath, { flags: "wx" }),
    );
    await writeFile(
      `${filePath}.json`,
      JSON.stringify({ contentType, ownerUserId: session.user.id }),
      "utf8",
    );
    await saveDurableConnectorIcon(
      iconId,
      Readable.toWeb(createReadStream(filePath)),
      contentType,
    );
    return Response.json(
      { iconUrl: `/api/connectors/icons/${iconId}`, size: received },
      { status: 201 },
    );
  } catch {
    await unlink(filePath).catch(() => undefined);
    await unlink(`${filePath}.json`).catch(() => undefined);
    return Response.json({ error: "icon_upload_failed" }, { status: 413 });
  }
}
