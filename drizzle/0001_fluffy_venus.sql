CREATE TABLE `BoardAnnotation` (
	`id` text PRIMARY KEY NOT NULL,
	`targetKind` text NOT NULL,
	`targetId` text NOT NULL,
	`columnName` text,
	`body` text DEFAULT '' NOT NULL,
	`x` real,
	`y` real,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `BoardAnnotation_target_idx` ON `BoardAnnotation` (`targetId`);