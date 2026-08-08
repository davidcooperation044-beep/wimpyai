import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';

export default async function SharePage({ params }: { params: { token: string } }) {
  const token = params.token;
  const { data: share } = await supabaseServer.from('wai_shares').select('conversation_id').eq('token', token).limit(1).single();
  if (!share?.conversation_id) return notFound();

  const { data: conv } = await supabaseServer.from('wai_conversations').select('id,title').eq('id', share.conversation_id).limit(1).single();
  const { data: messages } = await supabaseServer.from('wai_messages').select('id,role,content,images,created_at').eq('conversation_id', share.conversation_id).order('created_at', { ascending: true });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{conv?.title ?? 'Shared Conversation'}</h1>
      <div className="mt-4 space-y-4">
        {Array.isArray(messages) ? messages.map((m: any) => (
          <div key={m.id} className={`rounded-lg border p-4 ${m.role === 'assistant' ? 'bg-white' : 'bg-gray-50'}`}>
            {m.images?.length ? <img src={m.images[0]} alt="img" className="mb-3 max-h-80 rounded" /> : null}
            <div className="whitespace-pre-wrap">{m.content}</div>
            <div className="mt-2 text-xs text-muted">{new Date(m.created_at).toLocaleString()}</div>
          </div>
        )) : null}
      </div>
    </div>
  );
}
