import { kv } from '@vercel/kv';

// POST   /api/subscribe?user=X  { subscription }  -> guarda a inscrição de push desse aparelho
// DELETE /api/subscribe?user=X                     -> remove todas as inscrições desse usuário

export default async function handler(req, res) {
  const user = (req.query.user || '').toString().trim().toLowerCase();
  if (!user) {
    return res.status(400).json({ error: 'faltando ?user=<seu_usuario> na URL' });
  }
  const key = `push:${user}`;

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }
    const subscription = body && body.subscription;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'inscrição inválida' });
    }

    const subs = (await kv.get(key)) || [];
    const already = subs.some((s) => s.endpoint === subscription.endpoint);
    if (!already) {
      subs.push(subscription);
      await kv.set(key, subs);
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    await kv.del(key);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', ['POST', 'DELETE']);
  return res.status(405).json({ error: 'método não permitido' });
}
