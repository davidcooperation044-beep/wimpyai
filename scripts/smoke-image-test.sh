#!/usr/bin/env bash
# Simple smoke test for WimpyAI image generation
# Requires dev server running at http://localhost:3000 and OPENROUTER_API_KEY set in the environment

API_HOST=${API_HOST:-http://localhost:3000}
PROMPT=${1:-"A friendly golden retriever astronaut, photorealistic"}

echo "Using API host: $API_HOST"

echo "Posting to /api/chat to request image generation via tool-calling..."
curl -s -N \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"$PROMPT\", \"persona\": \"Creative\"}" \
  "$API_HOST/api/chat" | sed -u 's/\\r//g' | sed -n '1,200p'

echo "\nIf the chat route returns an SSE stream, watch for a JSON frame that includes \"imageUrl\"."