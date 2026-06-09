ALTER TABLE "Feedback" ADD COLUMN "deleteToken" text;--> statement-breakpoint
UPDATE "Feedback" SET "deleteToken" = gen_random_uuid()::text WHERE "deleteToken" IS NULL;--> statement-breakpoint
ALTER TABLE "Feedback" ALTER COLUMN "deleteToken" SET NOT NULL;
