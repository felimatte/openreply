import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";

export async function GET(request: Request) {
  const destination = new URL("/settings#musa", request.url);
  if (await getCurrentUserId()) return NextResponse.redirect(destination);
  const login = new URL("/login", request.url);
  login.searchParams.set("callbackUrl", "/settings#musa");
  return NextResponse.redirect(login);
}
