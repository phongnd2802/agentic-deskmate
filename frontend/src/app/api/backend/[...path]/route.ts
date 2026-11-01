import { NextRequest, NextResponse } from "next/server";

import { backendUrl } from "@/lib/backend";

// Only what the browser really calls. Everything else on FastAPI (docs, openapi.json, /agent) stays unreachable (ADR-0003).
const ALLOWED = new Set(["POST auth/sign-in", "POST auth/sign-out"]);

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!ALLOWED.has(`${request.method} ${path.join("/")}`)) return new NextResponse("Not found", { status: 404 });
  const url = `${backendUrl}/${path.join("/")}${request.nextUrl.search}`;
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    responseHeaders.set(key, value);
  });
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) responseHeaders.append("set-cookie", c);

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export { proxy as GET, proxy as POST };
