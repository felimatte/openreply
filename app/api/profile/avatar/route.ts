import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const avatarSchema = z.object({
  image: z
    .string()
    .max(700_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
});

export async function PUT(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Sign in to save a profile photo." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The image could not be read." }, { status: 400 });
  }

  const parsed = avatarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a smaller JPEG image and try again." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { image: parsed.data.image },
  });

  return NextResponse.json({ image: parsed.data.image });
}

export async function DELETE() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Sign in to update your profile." }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { image: null },
  });

  return NextResponse.json({ success: true });
}
