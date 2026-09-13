import { kv } from '@vercel/kv';
import crypto from 'crypto';

// Guarda, por usuário, a lista de códigos de webhook válidos.
// GET    /api/webhooks?user=X            -> lista os webhooks do usuário
// POST   /api/webhooks?user=X            -> cria um novo webhook com código aleatório
// DELETE /api/webhooks?user=X&code=Y     -> remove um webhook específico

export default async function handler(req, res) {
  const user = (req.query.user || '').toString().trim().toLowerCase();
  if (!user) {
    return res.status(400).json({ error: 'faltando ?user=<seu_usuario> na URL' });
  }
  const key = `webhooks:${user}`;

  if (req.method === 'GET') {
    const list = (await kv.get(key)) || [];
    return res.status(200).json(list);
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const name = (body && body.name ? String(body.name) : 'Webhook').slice(0, 60);
    const code = crypto.randomBytes(6).toString('hex');
    const entry = { code, name, createdAt: new Date().toISOString() };
    const list = (await kv.get(key)) || [];
    list.push(entry);
    await kv.set(key, list);
    return res.status(200).json(entry);
  }

  if (req.method === 'DELETE') {
    const code = (req.query.code || '').toString();
    if (!code) {
      return res.status(400).json({ error: 'faltando ?code= do webhook a remover' });
    }
    const list = (await kv.get(key)) || [];
    const filtered = list.filter((w) => w.code !== code);
    await kv.set(key, filtered);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  return res.status(405).json({ error: 'método não permitido' });
}
