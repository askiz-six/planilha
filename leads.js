import { kv } from '@vercel/kv';

// GET /api/leads?user=X -> retorna a lista de leads (novos contatos) desse usuário

export default async function handler(req, res) {
  const user = (req.query.user || '').toString().trim().toLowerCase();
  if (!user) {
    return res.status(400).json({ error: 'faltando ?user=<seu_usuario> na URL' });
  }

  if (req.method === 'GET') {
    const list = (await kv.get(`leads:${user}`)) || [];
    return res.status(200).json(list);
  }

  res.setHeader('Allow', ['GET']);
  return res.status(405).json({ error: 'método não permitido' });
}
