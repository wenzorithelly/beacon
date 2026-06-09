CREATE TABLE `AppSetting` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`intelModel` text DEFAULT 'claude-haiku-4-5' NOT NULL,
	`intelProvider` text DEFAULT 'auto' NOT NULL,
	`editor` text DEFAULT 'auto' NOT NULL,
	`currentFeatureId` text,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `CodeFile` (
	`path` text PRIMARY KEY NOT NULL,
	`root` text,
	`lang` text,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`mtimeMs` real,
	`size` integer,
	`inDegree` integer DEFAULT 0 NOT NULL,
	`outDegree` integer DEFAULT 0 NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `CodeFileEdge` (
	`fromPath` text NOT NULL,
	`toPath` text NOT NULL,
	`circular` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`fromPath`, `toPath`),
	FOREIGN KEY (`fromPath`) REFERENCES `CodeFile`(`path`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`toPath`) REFERENCES `CodeFile`(`path`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `CodeFileEdge_circular_idx` ON `CodeFileEdge` (`circular`);--> statement-breakpoint
CREATE INDEX `CodeFileEdge_toPath_idx` ON `CodeFileEdge` (`toPath`);--> statement-breakpoint
CREATE INDEX `CodeFileEdge_fromPath_idx` ON `CodeFileEdge` (`fromPath`);--> statement-breakpoint
CREATE TABLE `DbColumn` (
	`id` text PRIMARY KEY NOT NULL,
	`tableId` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`isPk` integer DEFAULT false NOT NULL,
	`isFk` integer DEFAULT false NOT NULL,
	`nullable` integer DEFAULT true NOT NULL,
	`note` text,
	`ord` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tableId`) REFERENCES `DbTable`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `DbColumn_tableId_name_key` ON `DbColumn` (`tableId`,`name`);--> statement-breakpoint
CREATE INDEX `DbColumn_tableId_idx` ON `DbColumn` (`tableId`);--> statement-breakpoint
CREATE TABLE `DbRelation` (
	`id` text PRIMARY KEY NOT NULL,
	`fromTableId` text NOT NULL,
	`toTableId` text NOT NULL,
	`fromColumn` text NOT NULL,
	`toColumn` text NOT NULL,
	`label` text,
	FOREIGN KEY (`fromTableId`) REFERENCES `DbTable`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`toTableId`) REFERENCES `DbTable`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `DbRelation_toTableId_idx` ON `DbRelation` (`toTableId`);--> statement-breakpoint
CREATE INDEX `DbRelation_fromTableId_idx` ON `DbRelation` (`fromTableId`);--> statement-breakpoint
CREATE TABLE `DbTable` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`description` text,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `DbTable_domain_idx` ON `DbTable` (`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `DbTable_name_key` ON `DbTable` (`name`);--> statement-breakpoint
CREATE TABLE `DraftColumn` (
	`id` text PRIMARY KEY NOT NULL,
	`tableId` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`isPk` integer DEFAULT false NOT NULL,
	`isFk` integer DEFAULT false NOT NULL,
	`nullable` integer DEFAULT true NOT NULL,
	`note` text,
	`ord` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tableId`) REFERENCES `DraftTable`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `DraftColumn_tableId_idx` ON `DraftColumn` (`tableId`);--> statement-breakpoint
CREATE TABLE `DraftRelation` (
	`id` text PRIMARY KEY NOT NULL,
	`fromTableId` text NOT NULL,
	`toTableId` text NOT NULL,
	`fromColumn` text NOT NULL,
	`toColumn` text NOT NULL,
	`label` text,
	FOREIGN KEY (`fromTableId`) REFERENCES `DraftTable`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`toTableId`) REFERENCES `DraftTable`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `DraftRelation_toTableId_idx` ON `DraftRelation` (`toTableId`);--> statement-breakpoint
CREATE INDEX `DraftRelation_fromTableId_idx` ON `DraftRelation` (`fromTableId`);--> statement-breakpoint
CREATE TABLE `DraftTable` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`description` text,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `DraftTable_name_key` ON `DraftTable` (`name`);--> statement-breakpoint
CREATE TABLE `Edge` (
	`id` text PRIMARY KEY NOT NULL,
	`fromId` text NOT NULL,
	`toId` text NOT NULL,
	`kind` text DEFAULT 'DEPENDS' NOT NULL,
	`label` text,
	`sourceHandle` text,
	`targetHandle` text,
	FOREIGN KEY (`fromId`) REFERENCES `Node`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`toId`) REFERENCES `Node`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Edge_fromId_toId_kind_key` ON `Edge` (`fromId`,`toId`,`kind`);--> statement-breakpoint
CREATE INDEX `Edge_toId_idx` ON `Edge` (`toId`);--> statement-breakpoint
CREATE INDEX `Edge_fromId_idx` ON `Edge` (`fromId`);--> statement-breakpoint
CREATE TABLE `Endpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`domain` text,
	`description` text,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Endpoint_method_path_key` ON `Endpoint` (`method`,`path`);--> statement-breakpoint
CREATE INDEX `Endpoint_domain_idx` ON `Endpoint` (`domain`);--> statement-breakpoint
CREATE TABLE `EndpointTable` (
	`id` text PRIMARY KEY NOT NULL,
	`endpointId` text NOT NULL,
	`tableId` text NOT NULL,
	`access` text DEFAULT 'read' NOT NULL,
	FOREIGN KEY (`endpointId`) REFERENCES `Endpoint`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`tableId`) REFERENCES `DbTable`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `EndpointTable_endpointId_tableId_key` ON `EndpointTable` (`endpointId`,`tableId`);--> statement-breakpoint
CREATE INDEX `EndpointTable_tableId_idx` ON `EndpointTable` (`tableId`);--> statement-breakpoint
CREATE TABLE `Node` (
	`id` text PRIMARY KEY NOT NULL,
	`view` text NOT NULL,
	`cluster` text,
	`title` text NOT NULL,
	`role` text,
	`plain` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`sourceRef` text,
	`externalId` text,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`parentId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`embedding` text,
	FOREIGN KEY (`parentId`) REFERENCES `Node`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Node_cluster_idx` ON `Node` (`cluster`);--> statement-breakpoint
CREATE INDEX `Node_parentId_idx` ON `Node` (`parentId`);--> statement-breakpoint
CREATE INDEX `Node_view_idx` ON `Node` (`view`);--> statement-breakpoint
CREATE TABLE `NodeFile` (
	`id` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`path` text NOT NULL,
	FOREIGN KEY (`nodeId`) REFERENCES `Node`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `NodeFile_nodeId_path_key` ON `NodeFile` (`nodeId`,`path`);--> statement-breakpoint
CREATE INDEX `NodeFile_nodeId_idx` ON `NodeFile` (`nodeId`);--> statement-breakpoint
CREATE TABLE `_NodeTags` (
	`A` text NOT NULL,
	`B` text NOT NULL,
	FOREIGN KEY (`A`) REFERENCES `Node`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`B`) REFERENCES `Tag`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_NodeTags_AB_unique` ON `_NodeTags` (`A`,`B`);--> statement-breakpoint
CREATE INDEX `_NodeTags_B_index` ON `_NodeTags` (`B`);--> statement-breakpoint
CREATE TABLE `Note` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'Untitled' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`ord` real DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Note_updatedAt_idx` ON `Note` (`updatedAt`);--> statement-breakpoint
CREATE TABLE `ProjectMeta` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`overview` text,
	`conventions` text DEFAULT '[]' NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `SyncState` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`codeGraphSyncedAt` integer,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Tag` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Tag_label_key` ON `Tag` (`label`);