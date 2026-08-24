import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { dataDirectory } from "../../../../lib/dataDirectory.js";
import { getDurableConnectorIcon } from "../../../../lib/durableAuthStore.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const iconDirectory = resolve(dataDirectory, "connector-icons");

export async function GET(_request, { params }) {
  const { iconId } = await params;
  if (!/^[a-f0-9-]{36}$/u.test(iconId || "")) {
    return new Response(null, { status: 404 });
  }
  const filePath = resolve(iconDirectory, iconId);
  try {
    const fileStat = await stat(filePath);
    const metadata = JSON.parse(await readFile(`${filePath}.json`, "utf8"));
    return new Response(Readable.toWeb(createReadStream(filePath)), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(fileStat.size),
        "Content-Type": metadata.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    const durableIcon = await getDurableConnectorIcon(iconId);
    return durableIcon
      ? new Response(durableIcon.stream, {
          headers: {
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Type": durableIcon.contentType,
            "X-Content-Type-Options": "nosniff",
          },
        })
      : new Response(null, { status: 404 });
  }
}
