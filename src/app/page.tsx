import { redirect } from "next/navigation";
import { householdExists } from "@/lib/auth";

export default async function Home() {
  redirect((await householdExists()) ? "/tableau-de-bord" : "/setup");
}
