CREATE TABLE "SharedBoard" (
	"token" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"selectedTabs" text NOT NULL,
	"workspaceLabel" text,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone
);
