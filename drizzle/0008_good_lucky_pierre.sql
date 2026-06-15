CREATE TABLE `PlanContract` (
	`id` text PRIMARY KEY NOT NULL,
	`planId` text NOT NULL,
	`declaredFiles` text DEFAULT '[]' NOT NULL,
	`authorizedExtras` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PlanContract_planId_key` ON `PlanContract` (`planId`);--> statement-breakpoint
CREATE INDEX `PlanContract_active_idx` ON `PlanContract` (`active`);--> statement-breakpoint
CREATE TABLE `WorkspaceFlag` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`config` text,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `WorkspaceFlag_key_key` ON `WorkspaceFlag` (`key`);