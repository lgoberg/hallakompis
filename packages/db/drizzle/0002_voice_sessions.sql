CREATE TYPE "public"."voice_input_mode" AS ENUM('web-speech', 'media-recorder', 'whisper-streaming', 'realtime');--> statement-breakpoint
CREATE TYPE "public"."voice_output_mode" AS ENUM('browser-tts', 'elevenlabs', 'realtime');--> statement-breakpoint
CREATE TYPE "public"."voice_session_result" AS ENUM('success', 'cancelled', 'no-speech', 'stt-error', 'llm-error', 'tts-error', 'permission-denied');--> statement-breakpoint
CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"input_mode" "voice_input_mode" NOT NULL,
	"output_mode" "voice_output_mode" NOT NULL,
	"result" "voice_session_result" NOT NULL,
	"error_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"stt_latency_ms" integer,
	"llm_latency_ms" integer,
	"tts_latency_ms" integer,
	"total_latency_ms" integer,
	"transcript" text,
	"response_text" text
);
--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_voice_sessions_user_time" ON "voice_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_voice_sessions_result" ON "voice_sessions" USING btree ("result");