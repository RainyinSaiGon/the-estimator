CREATE TABLE `workflow_export_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_export_snapshots_company_expiry` ON `workflow_export_snapshots` (`company_id`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `workflow_export_snapshot_items` (
	`snapshot_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_object_deletions` (
	`object_key` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `workflow_object_deletions_due` ON `workflow_object_deletions` (`available_at`,`created_at`);
