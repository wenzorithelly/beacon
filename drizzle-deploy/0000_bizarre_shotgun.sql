CREATE TABLE "Feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
