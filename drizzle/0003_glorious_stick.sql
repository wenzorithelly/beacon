CREATE TABLE `BugFlag` (
	`id` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`by` text NOT NULL,
	`note` text NOT NULL,
	`resolvedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`nodeId`) REFERENCES `Node`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `BugFlag_nodeId_idx` ON `BugFlag` (`nodeId`);--> statement-breakpoint
ALTER TABLE `Node` ADD `kind` text DEFAULT 'FEATURE' NOT NULL;