-- Migration: Deploy System Schema
-- Issue: #69
-- Description: Add enums, tables, columns, and indexes for the deploy system
-- Non-destructive: all new columns are nullable, enum changes are additive first

-- =============================================================================
-- STEP 1: ALTER ENUMS (add new values first, then handle removals carefully)
-- =============================================================================

-- agent_status: add new values
ALTER TYPE "agent_status" ADD VALUE IF NOT EXISTS 'provisioning';
ALTER TYPE "agent_status" ADD VALUE IF NOT EXISTS 'unreachable';
ALTER TYPE "agent_status" ADD VALUE IF NOT EXISTS 'destroyed';

-- task_status: add new values
ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'locked';
ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'cancelling';

-- log_level: add new value
ALTER TYPE "log_level" ADD VALUE IF NOT EXISTS 'lifecycle';

-- =============================================================================
-- STEP 2: CREATE NEW ENUMS
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "deploy_status" AS ENUM ('provisioning', 'installing', 'configuring', 'registering', 'ready', 'failed', 'destroyed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "instance_size" AS ENUM ('small', 'medium', 'large');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "cloud_provider" AS ENUM ('digitalocean', 'gcp');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- STEP 3: CREATE NEW TABLES
-- =============================================================================

-- deploys table
CREATE TABLE IF NOT EXISTS "deploys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id" uuid REFERENCES "agents"("id"),
  "agent_name" varchar(100) NOT NULL,
  "cloud_provider" "cloud_provider" NOT NULL,
  "region" varchar(50) NOT NULL,
  "instance_size" "instance_size" NOT NULL,
  "instance_id" varchar(255),
  "status" "deploy_status" NOT NULL DEFAULT 'provisioning',
  "phases" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error" text,
  "started_at" timestamp NOT NULL,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- agent_telemetry table
CREATE TABLE IF NOT EXISTS "agent_telemetry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "timestamp" timestamp NOT NULL,
  "infra" jsonb,
  "llm" jsonb,
  "tasks" jsonb,
  "daemon" jsonb
);

-- settings table
CREATE TABLE IF NOT EXISTS "settings" (
  "key" varchar(100) PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- task_progress table (schema ready, implementation Phase 2)
CREATE TABLE IF NOT EXISTS "task_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "step" text NOT NULL,
  "tool_call" varchar(50),
  "timestamp" timestamp NOT NULL
);

-- =============================================================================
-- STEP 4: ADD NEW COLUMNS TO EXISTING TABLES
-- =============================================================================

-- agents: new fields (all nullable for backward compatibility)
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "version" varchar(20);
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "openclaw_version" varchar(20);
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "cloud" jsonb;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "capabilities_list" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "private_ip" varchar(45);
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "deploy_id" uuid REFERENCES "deploys"("id");

-- tasks: new fields (all nullable for backward compatibility)
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "role_target" uuid REFERENCES "roles"("id");
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "locked_by" uuid REFERENCES "agents"("id");
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "locked_at" timestamp;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_task_id" uuid REFERENCES "tasks"("id");
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "artifacts" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- logs: new field
ALTER TABLE "logs" ADD COLUMN IF NOT EXISTS "component" varchar(50);

-- =============================================================================
-- STEP 5: CREATE INDEXES
-- =============================================================================

-- deploys indexes
CREATE INDEX IF NOT EXISTS "deploys_agent_id_idx" ON "deploys" ("agent_id");
CREATE INDEX IF NOT EXISTS "deploys_status_idx" ON "deploys" ("status");

-- agent_telemetry indexes
CREATE INDEX IF NOT EXISTS "agent_telemetry_agent_id_timestamp_idx" ON "agent_telemetry" ("agent_id", "timestamp");

-- task_progress indexes
CREATE INDEX IF NOT EXISTS "task_progress_task_id_idx" ON "task_progress" ("task_id");

-- tasks indexes (new)
CREATE INDEX IF NOT EXISTS "tasks_role_target_status_idx" ON "tasks" ("role_target", "status");
CREATE INDEX IF NOT EXISTS "tasks_locked_by_idx" ON "tasks" ("locked_by");
CREATE INDEX IF NOT EXISTS "tasks_parent_task_id_idx" ON "tasks" ("parent_task_id");

-- tasks indexes (ensure existing)
CREATE INDEX IF NOT EXISTS "tasks_team_id_idx" ON "tasks" ("team_id");
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" ("status");

-- agents indexes (ensure existing)
CREATE INDEX IF NOT EXISTS "agents_team_id_idx" ON "agents" ("team_id");
CREATE INDEX IF NOT EXISTS "agents_role_id_idx" ON "agents" ("role_id");

-- logs indexes (new)
CREATE INDEX IF NOT EXISTS "logs_agent_id_timestamp_idx" ON "logs" ("agent_id", "timestamp");

-- =============================================================================
-- STEP 6: MIGRATE EXISTING DATA (enum value renames)
-- =============================================================================

-- Migrate 'online' → 'idle' in agents (online is being removed)
UPDATE "agents" SET "status" = 'idle' WHERE "status" = 'online';

-- Migrate 'running' → 'locked' in tasks (running is being removed)
UPDATE "tasks" SET "status" = 'locked' WHERE "status" = 'running';

-- Note: PostgreSQL does not support removing enum values directly.
-- The old values ('online', 'running') remain in the enum type but are
-- no longer used by the application. They can be cleaned up in a future
-- migration using the CREATE TYPE ... RENAME pattern if needed.
