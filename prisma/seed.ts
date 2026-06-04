import { seedDatabase } from "@/lib/seed";
import { seedDatabaseDesign } from "@/lib/seed-db";

// Run with `make seed` / `bun run db:seed`. Uses DATABASE_URL from .env (Bun auto-loads it).
await seedDatabase();
await seedDatabaseDesign();
console.log("Seed complete.");
