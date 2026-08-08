-- Table for shareable read-only conversation links
CREATE TABLE IF NOT EXISTS wai_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES wai_conversations(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS wai_shares_conversation_idx ON wai_shares(conversation_id);

-- Table for thumbs feedback on messages
CREATE TABLE IF NOT EXISTS wai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES wai_messages(id) ON DELETE CASCADE,
  user_id uuid NULL,
  vote smallint NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wai_feedback_message_idx ON wai_feedback(message_id);
