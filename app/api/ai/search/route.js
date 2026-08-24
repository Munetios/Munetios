import { GET as getHistory } from "../history/route.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const response = await getHistory(request);
  if (!response.ok) return response;

  const payload = await response.json();
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "")
    .trim()
    .toLocaleLowerCase();
  const type = String(url.searchParams.get("type") || "all").toLowerCase();
  const typeAliases = {
    chats: ["chat", "chats", "conversation"],
    code: ["code"],
    health: ["health"],
    images: ["image", "images"],
    library: ["library"],
    projects: ["project", "projects"],
    voice: ["voice"],
  };
  const results = (payload.conversations || [])
    .filter((conversation) =>
      query
        ? String(conversation.title || "")
            .toLocaleLowerCase()
            .includes(query)
        : true,
    )
    .filter((conversation) => {
      if (type === "all") return true;
      return typeAliases[type]?.includes(
        String(conversation.type || "chat").toLowerCase(),
      );
    })
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );

  return Response.json(
    { results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
