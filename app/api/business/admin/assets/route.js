import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { auth } from "../../../../../auth.js";
import {
  assertSameOrigin,
  getAccountData,
} from "../../../../lib/authSecurity.js";
import { normalizeBusinessAccount } from "../../../../lib/businessAccounts.js";
import { dataDirectory } from "../../../../lib/dataDirectory.js";
import { getBusinessPlanCapabilities } from "../../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maximumBytes = 500 * 1024 * 1024;
const allowedTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const assetDirectory = resolve(dataDirectory, "business-signin-assets");

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
    return Response.json({ error: "signin_required" }, { status: 401 });
  }
  const business = normalizeBusinessAccount(
    getAccountData(session.user.id, "business", null),
    session.user.id,
  );
  const capabilities = getBusinessPlanCapabilities(
    business?.plan,
    business?.verified,
  );
  if (!business || !capabilities.animatedSignInBackgrounds) {
    return Response.json(
      { error: "plan_feature_unavailable" },
      { status: 403 },
    );
  }
  const contentType = request.headers.get("content-type")?.split(";")[0] || "";
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (
    !allowedTypes.has(contentType) ||
    !request.body ||
    contentLength > maximumBytes
  ) {
    return Response.json({ error: "invalid_asset" }, { status: 413 });
  }

  mkdirSync(assetDirectory, { recursive: true });
  const assetId = randomUUID();
  const filePath = resolve(assetDirectory, assetId);
  const expectedPrefix = `${assetDirectory}${process.platform === "win32" ? "\\" : "/"}`;
  if (!filePath.startsWith(expectedPrefix)) {
    return Response.json({ error: "invalid_path" }, { status: 400 });
  }
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      callback(
        received > maximumBytes ? new Error("asset_too_large") : null,
        received > maximumBytes ? undefined : chunk,
      );
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
    return Response.json(
      {
        assetUrl: `/api/business/admin/assets/${assetId}`,
        size: received,
      },
      { status: 201 },
    );
  } catch {
    await unlink(filePath).catch(() => undefined);
    await unlink(`${filePath}.json`).catch(() => undefined);
    return Response.json({ error: "asset_upload_failed" }, { status: 413 });
  }
}
