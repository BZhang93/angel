import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/// The signed-in Supabase user id, or a redirect to /login. Every query in
/// src/lib/data scopes on this id, which is also what row-level security keys
/// off, so a missing session must never fall through to "no filter".
export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

export async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
