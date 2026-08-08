import { NextRequest, NextResponse } from 'next/server';
import { getUserFromBearerToken } from '@/lib/supabase-server';
import { recordUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  try {
    const MAX_BYTES = 10 * 1024 * 1024; // 10MB
    let filename = 'file.pdf';
    let buffer: Buffer | null = null;

    const contentType = req.headers.get('content-type') || '';
    if (contentType.startsWith('multipart/form-data')) {
      // handle multipart form with a file field named 'file'
      const form = await req.formData();
      const file = form.get('file') as any;
      if (!file || typeof file.arrayBuffer !== 'function') {
        return NextResponse.json({ error: 'missing-file' }, { status: 400 });
      }
      filename = file.name || filename;
      const arr = await file.arrayBuffer();
      if (arr.byteLength > MAX_BYTES) {
        return NextResponse.json({ error: 'file_too_large', maxBytes: MAX_BYTES }, { status: 413 });
      }
      buffer = Buffer.from(arr);
    } else {
      const body = await req.json();
      const data = typeof body?.data === 'string' ? body.data : null;
      filename = typeof body?.filename === 'string' ? body.filename : filename;
      if (!data) {
        return NextResponse.json({ error: 'missing-data' }, { status: 400 });
      }
      // data is expected to be a base64 string (may include data: prefix)
      const base64 = data.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(base64, 'base64');
      if (buffer.length > MAX_BYTES) {
        return NextResponse.json({ error: 'file_too_large', maxBytes: MAX_BYTES }, { status: 413 });
      }
    }

    // dynamic import to avoid top-level type issues
    // @ts-ignore: pdf-parse has no types in this project
    const imported = await import('pdf-parse');
    const pdfParse = imported.default ?? imported;

    const result: any = await pdfParse(buffer);

    const text = typeof result?.text === 'string' ? result.text : '';
    const numpages = typeof result?.numpages === 'number' ? result.numpages : null;

    try {
      const user = await getUserFromBearerToken(req.headers.get('authorization'));
      if (user) {
        const estimated = Math.max(1, Math.ceil(text.length / 1000));
        // record small usage for PDF extraction
        const { recordUsage } = await import('@/lib/usage');
        await recordUsage({ userId: user.id, event_type: 'pdf_extract', tokens: estimated, metadata: { filename, numpages } });
      }
    } catch (e) {
      // ignore
    }

    return NextResponse.json({ filename, text, numpages });
  } catch (error: any) {
    console.error('[extract-pdf] error', error);
    return NextResponse.json({ error: 'extract_failed', detail: String(error?.message ?? error) }, { status: 500 });
  }
}
