import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') || '';
    const limitParam = Number(url.searchParams.get('limit') || '10');
    const limit = Math.min(Math.max(1, limitParam), 50);

    if (!q || q.trim().length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Call the DB function created in migration
    const { data, error } = await supabaseServer.rpc('wai_search_messages', { q, limit_records: limit } as any);
    if (error) {
      console.error('[search] supabase rpc error', error);
      return NextResponse.json({ error: 'search_failed' }, { status: 500 });
    }

    return NextResponse.json({ results: data ?? [] });
  } catch (error) {
    console.error('[search] exception', error);
    return NextResponse.json({ error: 'exception' }, { status: 500 });
  }
}
