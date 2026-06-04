import { redirect } from "next/navigation";

export default function Home() {
  // The map is the primary view; until it ships, land on the list.
  redirect("/list");
}
