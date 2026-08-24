"use client";

import { useSearchParams } from "next/navigation";
import AiPage from "../../[[...page]]/page";
import SharedVoiceConversationPage from "../../share/[shareId]/page";

export default function VoiceConversationRoute() {
  const searchParams = useSearchParams();
  return searchParams.has("token")
    ? <SharedVoiceConversationPage />
    : <AiPage />;
}
