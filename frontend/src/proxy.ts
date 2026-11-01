import { NextResponse, type NextRequest } from "next/server";

import { fetchCurrentUser } from "@/lib/backend";

// Layouts do not re-run on client navigation, so every workspace request validates the session here.
export async function proxy(request: NextRequest) {
  if (await fetchCurrentUser(request.headers.get("cookie") ?? "")) return NextResponse.next();
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  matcher: ["/dashboard/:path*", "/chat/:path*", "/agents/:path*", "/knowledge-bases/:path*", "/settings/:path*"],
};
