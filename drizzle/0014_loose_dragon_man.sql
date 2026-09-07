CREATE TABLE `CodeSymbol` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`qualifiedName` text NOT NULL,
	`kind` text NOT NULL,
	`line` integer NOT NULL,
	`endLine` integer NOT NULL,
	`exported` integer DEFAULT false NOT NULL,
	`parentId` text,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`path`) REFERENCES `CodeFile`(`path`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`parentId`) REFERENCES `CodeSymbol`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `CodeSymbol_path_idx` ON `CodeSymbol` (`path`);--> statement-breakpoint
CREATE INDEX `CodeSymbol_name_idx` ON `CodeSymbol` (`name`);--> statement-breakpoint
CREATE TABLE `CodeSymbolEdge` (
	`fromId` text NOT NULL,
	`toId` text NOT NULL,
	`relation` text NOT NULL,
	`confidence` text NOT NULL,
	`line` integer,
	PRIMARY KEY(`fromId`, `toId`, `relation`),
	FOREIGN KEY (`fromId`) REFERENCES `CodeSymbol`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`toId`) REFERENCES `CodeSymbol`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `CodeSymbolEdge_toId_idx` ON `CodeSymbolEdge` (`toId`);--> statement-breakpoint
CREATE INDEX `CodeSymbolEdge_fromId_idx` ON `CodeSymbolEdge` (`fromId`);--> statement-breakpoint
ALTER TABLE `SyncState` ADD `symbolGraphSyncedAt` integer;