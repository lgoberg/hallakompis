CREATE TYPE "public"."memory_event_type" AS ENUM('decision', 'outcome', 'state', 'event');--> statement-breakpoint
CREATE TABLE "memory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "memory_event_type" NOT NULL,
	"content" text NOT NULL,
	"structured" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536),
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_message_id" uuid,
	"reflects_on_event_id" uuid,
	"confidence" real DEFAULT 0.7 NOT NULL,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "memory_reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"embedding" vector(1536),
	"active" boolean DEFAULT true NOT NULL,
	"last_reinforced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "summary_embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_reflections" ADD CONSTRAINT "memory_reflections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mem_events_user_time" ON "memory_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_mem_events_user_type" ON "memory_events" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_mem_reflections_user" ON "memory_reflections" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "idx_chatmsg_conv_time" ON "chat_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_conv_user_time" ON "conversations" USING btree ("user_id","started_at");