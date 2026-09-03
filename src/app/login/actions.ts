"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type AuthResult = { status: "error"; message: string } | { status: "confirm-email" };

export async function login(formData: FormData): Promise<AuthResult | void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signup(formData: FormData): Promise<AuthResult | void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  // Point the confirmation email at THIS deployment's callback (local, preview
  // or prod) rather than Supabase's fixed Site URL. The origin must be listed in
  // the project's Auth redirect allowlist or Supabase ignores it.
  const origin = (await headers()).get("origin");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: origin ? { emailRedirectTo: `${origin}/auth/callback` } : undefined,
  });
  if (error) return { status: "error", message: error.message };

  // With email confirmation on (the Supabase default) signUp returns no
  // session; say so rather than redirecting into a route the proxy bounces.
  if (!data.session) return { status: "confirm-email" };

  revalidatePath("/", "layout");
  redirect("/");
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
