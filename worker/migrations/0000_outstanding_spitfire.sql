CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mailboxes_address` ON `mailboxes` (`address`);--> statement-breakpoint
CREATE INDEX `idx_mailboxes_expires_at` ON `mailboxes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_address` text NOT NULL,
	`subject` text DEFAULT '(No subject)' NOT NULL,
	`text_body` text DEFAULT '' NOT NULL,
	`html_body` text,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_mailbox_received` ON `messages` (`mailbox_id`,`received_at`);--> statement-breakpoint
PRAGMA optimize;
