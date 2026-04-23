import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  revalidatePath("/");
  revalidateTag("dashboard", { expire: 0 });
  revalidateTag("column-creations", { expire: 0 });
  revalidateTag("chats", { expire: 0 });

  return Response.json({ revalidated: true, now: Date.now() });
}
