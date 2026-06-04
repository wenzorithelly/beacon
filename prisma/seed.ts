import { seedDatabase } from "@/lib/seed";

// Run with `make seed` / `bun run db:seed`. Uses DATABASE_URL from .env (Bun auto-loads it).
await seedDatabase();
console.log("Seed complete.");
