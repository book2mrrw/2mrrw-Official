import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
<<<<<<< HEAD
  process.env.SUPABASE_SERVICE_ROLE_KEY
=======
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
>>>>>>> 01e26835f12a7a02e16176ee27f17cf667c227e1
);

export async function POST(req) {
  try {
    const { name, phone, email } = await req.json();

    const { data, error } = await supabase
      .from("users")
      .upsert({ name, phone, email }, { onConflict: "email" })
      .select()
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}