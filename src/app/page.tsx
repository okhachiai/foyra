import { redirect } from "next/navigation";
import { householdExists } from "@/lib/auth";

export default async function Home() {
  redirect((await householdExists()) ? "/dashboard" : "/setup");
}
