export const dynamic = "force-dynamic";

function encryptedVaultRequired() {
  return Response.json(
    { error: "encrypted_vault_required" },
    { headers: { "Cache-Control": "no-store" }, status: 410 },
  );
}

export const GET = encryptedVaultRequired;
export const POST = encryptedVaultRequired;
export const DELETE = encryptedVaultRequired;
