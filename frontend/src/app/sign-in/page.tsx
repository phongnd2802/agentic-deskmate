import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { SignInForm } from "@/components/sign-in-form";

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/chat");
  return <SignInForm />;
}