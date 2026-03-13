/**
 * Next.js middleware — access control
 *
 * Rules:
 *   /api/webhook/*  — public (Notion must be able to POST here)
 *   everything else — HTTP Basic Auth using DASHBOARD_USER / DASHBOARD_PASSWORD env vars
 *
 * Set both env vars in Vercel → Project Settings → Environment Variables.
 * The browser will show a native login dialog on first visit.
 */

import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/api/webhook/main", "/api/webhook/other"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow webhook endpoints through — Notion's servers call these.
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;

  // If env vars aren't set yet, block access entirely rather than leave it open.
  if (!user || !password) {
    return new NextResponse("Service unavailable: auth not configured", {
      status: 503,
    });
  }

  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Basic ")) {
    const base64 = authHeader.slice("Basic ".length);
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    const [incomingUser, ...rest] = decoded.split(":");
    const incomingPassword = rest.join(":"); // passwords may contain ":"

    // Constant-time comparison to prevent timing attacks.
    const userMatch =
      incomingUser.length === user.length &&
      incomingUser
        .split("")
        .every((char, i) => char === user[i]);
    const passMatch =
      incomingPassword.length === password.length &&
      incomingPassword
        .split("")
        .every((char, i) => char === password[i]);

    if (userMatch && passMatch) {
      return NextResponse.next();
    }
  }

  // Prompt the browser to show its native login dialog.
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Notion Workspace Sync", charset="UTF-8"',
    },
  });
}

export const config = {
  // Apply to all routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
