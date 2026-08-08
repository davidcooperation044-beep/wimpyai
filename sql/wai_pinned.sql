-- Add pinned column to conversations
ALTER TABLE IF EXISTS wai_conversations ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS wai_conversations_pinned_idx ON wai_conversations (pinned DESC, updated_at DESC);
