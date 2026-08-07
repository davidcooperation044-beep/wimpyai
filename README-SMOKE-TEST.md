# Smoke Test: Image Generation

This repository includes a simple smoke-test to verify the image-generation flow is wired end-to-end.

Prerequisites
- Start the Next.js dev server (typically `npm run dev`) so `http://localhost:3000` is live.
- Set `OPENROUTER_API_KEY` in your shell environment so the server can call OpenRouter.

Shell (macOS / WSL / Git Bash)

```bash
API_HOST=http://localhost:3000 ./scripts/smoke-image-test.sh "A friendly golden retriever astronaut, photorealistic"
```

Windows (PowerShell / cmd)

```powershell
# PowerShell
$env:API_HOST = 'http://localhost:3000'
node scripts/smoke-image-test-node.js "A friendly golden retriever astronaut, photorealistic"
```

What to look for
- The `/api/chat` SSE stream should emit JSON frames. One frame should include an `imageUrl` field with a downloadable image URL.
- If the model invoked the `generate_image` function, the backend will call OpenRouter and then emit `imageUrl` in the SSE stream.

Next steps
- If you want, I can run this locally in the workspace (start dev server and run the smoke test), or add an automated GitHub Actions workflow to run a non-OpenRouter smoke check (mocked responses).