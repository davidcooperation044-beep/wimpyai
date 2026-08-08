-- Create GIN index on message content for full-text search
CREATE INDEX IF NOT EXISTS wai_messages_content_tsv_idx ON wai_messages USING GIN (to_tsvector('english', coalesce(content, '')));

-- Optional index on conversation title
CREATE INDEX IF NOT EXISTS wai_conversations_title_tsv_idx ON wai_conversations USING GIN (to_tsvector('english', coalesce(title, '')));

-- Function to search messages by relevance
CREATE OR REPLACE FUNCTION wai_search_messages(q text, limit_records int DEFAULT 10)
RETURNS TABLE(id uuid, conversation_id uuid, role text, content text, created_at timestamptz, rank double precision) AS $$
  SELECT m.id, m.conversation_id, m.role, m.content, m.created_at,
    ts_rank(to_tsvector('english', coalesce(m.content, '')), plainto_tsquery('english', q)) AS rank
  FROM wai_messages m
  WHERE to_tsvector('english', coalesce(m.content, '')) @@ plainto_tsquery('english', q)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT limit_records;
$$ LANGUAGE SQL STABLE;
