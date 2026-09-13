import { kv } from '@vercel/kv';

// POST { action: 'rename', oldUser, newUser } -> move os webhooks e vendas do usuário antigo pro novo nome
// DELETE ?user=X                             -> apaga webhooks e vendas desse usuário

export default async function handler(req, res) {
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const action = body && body.action;

    if (action === 'rename') {
      const oldUser = (body.oldUser || '').toString().trim().toLowerCase();
      const newUser = (body.newUser || '').toString().trim().toLowerCase();
      if (!oldUser || !newUser) {
        return res.status(400).json({ error: 'faltando oldUser/newUser' });
      }

      const oldWebhooks = await kv.get(`webhooks:${oldUser}`);
      const oldVendas = await kv.get(`vendas:${oldUser}`);

      if (oldWebhooks) {
        await kv.set(`webhooks:${newUser}`, oldWebhooks);
        await kv.del(`webhooks:${oldUser}`);
      }
      if (oldVendas) {
        await kv.set(`vendas:${newUser}`, oldVendas);
        await kv.del(`vendas:${oldUser}`);
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'ação inválida' });
  }

  if (req.method === 'DELETE') {
    const user = (req.query.user || '').toString().trim().toLowerCase();
    if (!user) {
      return res.status(400).json({ error: 'faltando ?user=' });
    }
    await kv.del(`webhooks:${user}`);
    await kv.del(`vendas:${user}`);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', ['POST', 'DELETE']);
  return res.status(405).json({ error: 'método não permitido' });
}
