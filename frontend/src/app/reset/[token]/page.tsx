import { AccessLinkForm } from "@/components/access-link-form";
import { fetchLinkPreview } from "@/lib/backend";

// Public: the link is the proof, so this page shows nothing but what the token is for.
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await fetchLinkPreview("password-resets", token);
  if ("code" in preview) return <AccessLinkForm kind="password-resets" token={token} problem={preview.code} />;
  return <AccessLinkForm kind="password-resets" token={token} email={preview.email} organization={preview.organization_name} />;
}
