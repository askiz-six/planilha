import { kv } from '@vercel/kv';

// Essa função faz duas coisas, na mesma URL:
//  - POST: recebe o webhook da plataforma de vendas (venda aprovada) e guarda o lucro.
//  - GET:  o site chama pra buscar as vendas aprovadas de um usuário e mostrar na tela.
//
// A URL sempre inclui ?user=<nome_de_usuario> pra saber de quem é a venda.

export default async function handler(req, res) {
  const user = (req.query.user || '').toString().trim().toLowerCase();

  if (!user) {
    return res.status(400).json({ error: 'faltando ?user=<seu_usuario> na URL' });
  }

  const key = `vendas:${user}`;

  if (req.method === 'GET') {
    const list = (await kv.get(key)) || [];
    return res.status(200).json(list);
  }

  if (req.method === 'POST') {
    const code = (req.query.code || '').toString();
    if (!code) {
      return res.status(401).json({ error: 'faltando ?code= na URL do webhook' });
    }
    const validWebhooks = (await kv.get(`webhooks:${user}`)) || [];
    const matchedWebhook = validWebhooks.find((w) => w.code === code);
    if (!matchedWebhook) {
      return res.status(401).json({ error: 'código de webhook inválido ou removido' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }

    if (!body || !body.event) {
      return res.status(400).json({ error: 'payload inválido' });
    }

    // só nos interessa venda aprovada — ignora venda gerada (pendente) e novo lead
    if (body.event !== 'payment_approved') {
      return res.status(200).json({ ignored: true, event: body.event });
    }

    const tx = body.data && body.data.transaction;
    if (!tx) {
      return res.status(400).json({ error: 'transaction ausente no payload' });
    }

    const rawDate = tx.paid_at || tx.created_at || new Date().toISOString();
    const dateOnly = String(rawDate).slice(0, 10);

    const entry = {
      id: 'wh_' + (tx.id || tx.external_id || body.webhook_id || Date.now()),
      value: Number(tx.amount) || 0,
      desc: [tx.plan_name, tx.payment_method].filter(Boolean).join(' · ') || 'Venda aprovada',
      date: dateOnly,
      category: matchedWebhook.name || 'Webhook'
    };

    const list = (await kv.get(key)) || [];
    const alreadyExists = list.some((e) => e.id === entry.id);
    if (!alreadyExists) {
      list.push(entry);
      await kv.set(key, list);
    }

    return res.status(200).json({ ok: true, added: !alreadyExists });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'método não permitido' });
}
