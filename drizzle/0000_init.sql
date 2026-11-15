CREATE TABLE `cities` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cities_slug_unique` ON `cities` (`slug`);--> statement-breakpoint
CREATE TABLE `http_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `http_cache_expires_idx` ON `http_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `itineraries` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`version` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `itineraries_trip_version_idx` ON `itineraries` (`trip_id`,`version`);--> statement-breakpoint
CREATE TABLE `llm_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_cache_expires_idx` ON `llm_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`city_id` text NOT NULL,
	`wiki_title` text NOT NULL,
	`wiki_url` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`pitch` text NOT NULL,
	`extract` text,
	`image_url` text,
	`image_author` text,
	`image_license` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`visit_minutes` integer NOT NULL,
	`popularity` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `places_city_wiki_idx` ON `places` (`city_id`,`wiki_title`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);
--> statement-breakpoint
CREATE TABLE `swipes` (
	`trip_id` text NOT NULL,
	`place_id` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`trip_id`, `place_id`),
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`city_id` text NOT NULL,
	`days` integer NOT NULL,
	`pace` text NOT NULL,
	`interests` text DEFAULT '[]' NOT NULL,
	`tag_weights` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'swiping' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE no action
);
