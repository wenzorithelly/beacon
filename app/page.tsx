import { redirect } from "next/navigation";

export default function Home() {
  redirect("/map?view=ROADMAP");
}
