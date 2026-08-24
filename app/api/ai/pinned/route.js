import {
  GET as getConversations,
  PATCH as patchConversation,
} from "../conversations/route.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const response = await getConversations(request);
  if (!response.ok) return response;

  const payload = await response.json();
  return Response.json(
    {
      pinned: (payload.conversations || []).filter(
        (conversation) => conversation.pinned === true,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request) {
  return patchConversation(request);
}
