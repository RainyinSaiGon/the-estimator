CREATE TABLE `workflow_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`request_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_audit_company` ON `workflow_audit` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workflow_credentials` (
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`verifier` text NOT NULL,
	`issued_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `workflow_inbound` (
	`company_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`payload_digest` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `submission_id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_members` (
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`company_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `workflow_members_user` ON `workflow_members` (`user_id`,`company_id`);