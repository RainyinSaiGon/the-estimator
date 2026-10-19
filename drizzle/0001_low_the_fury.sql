CREATE TABLE `workflow_companies` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_companies_owner_updated` ON `workflow_companies` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `workflow_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_requests_owner_company_updated` ON `workflow_requests` (`owner_id`,`company_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workflow_requests_company_status` ON `workflow_requests` (`company_id`,`status`);