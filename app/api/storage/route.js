import { requireAuth } from "../../../auth.js";
import {
  accountStorageBytes,
  getAccountStorageCapacity,
} from "../../lib/accountStorage.js";
import { getDemoSettings, getDemoStorage } from "../../lib/demoSettings.js";

export const dynamic = "force-dynamic";

function formatStorage(bytes) {
  if (bytes <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)}${units[unitIndex]}`;
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }

  const storage = session.demo
    ? getDemoStorage(getDemoSettings(session))
    : getAccountStorageCapacity(session.user.id);
  return Response.json(
    session.demo
      ? storage
      : {
          availableBytes: storage.availableBytes,
          totalBytes: accountStorageBytes,
          totalLabel: "96GB",
          usedBytes: storage.usedBytes,
          usedLabel: formatStorage(storage.usedBytes),
        },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
