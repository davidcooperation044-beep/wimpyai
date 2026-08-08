-- Create usage history table for tracking user operations
CREATE TABLE IF NOT EXISTS wai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  tokens integer DEFAULT 0 NOT NULL,
  cost numeric DEFAULT 0.0 NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wai_usage_user_created ON wai_usage(user_id, created_at DESC);
