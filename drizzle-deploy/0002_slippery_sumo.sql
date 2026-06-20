CREATE TABLE "TelemetryMachine" (
	"id" text PRIMARY KEY NOT NULL,
	"firstSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"version" text NOT NULL,
	"platform" text NOT NULL,
	"arch" text NOT NULL,
	"ci" boolean DEFAULT false NOT NULL,
	"heartbeatCount" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "TelemetryMachine_lastSeenAt_idx" ON "TelemetryMachine" USING btree ("lastSeenAt");