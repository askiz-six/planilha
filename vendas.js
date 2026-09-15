import { kv } from '@vercel/kv';
import webpush from 'web-push';

// Essa função recebe os 3 tipos de webhook da plataforma de vendas, na mesma URL:
//   - user_joined       -> novo lead (guarda contagem + lista pra mostrar em tempo real)
//   - payment_created   -> venda gerada (pendente) -> manda notificação push
//   - payment_approved  -> venda aprovada -> vira lucro no Trampo + manda notificação push
//
// GET  /api/vendas?user=X          -> o site busca as vendas aprovadas (lucro) desse usuário
// POST /api/vendas?user=X&code=Y   -> chamado pela plataforma de vendas (webhook)

const VAPID_PUBLIC_KEY = 'BBG2OwrTb9MsgekjRW0vo_bPf3T265MbRwqWRr5LUJSaizFuzjAtEz988KN5nOyz-F5FgRc7vSKopQKTHd6ieEU';
const VAPID_PRIVATE_KEY = 'yQc1LJfG11HrM8D35RBlrjVneZg968BThWrBsqbNABk';
webpush.setVapidDetails('mailto:contato@caixa.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

async function sendPush(user, title, body) {
  const subs = (await kv.get(`push:${user}`)) || [];
  if (!subs.length) return;
  const stillValid = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title, body }));
      stillValid.push(sub);
    } catch (e) {
      // assinatura expirada/inválida (410/404) — não guarda de volta
      if (e.statusCode !== 410 && e.statusCode !== 404) stillValid.push(sub);
    }
  }
  if (stillValid.length !== subs.length) {
    await kv.set(`push:${user}`, stillValid);
  }
}

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

    const customer = (body.data && body.data.customer) || {};
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.username || 'Alguém';

    // ---- novo lead ----
    if (body.event === 'user_joined') {
      const leadsKey = `leads:${user}`;
      const leadEntry = {
        id: 'lead_' + (customer.id || body.webhook_id || Date.now()),
        name: customerName,
        source: (body.data && body.data.tracking && body.data.tracking.utm_source) || null,
        date: (body.data && body.data.joined_at ? String(body.data.joined_at) : new Date().toISOString()).slice(0, 10),
        at: (body.data && body.data.joined_at) || new Date().toISOString(),
        category: matchedWebhook.name || 'Webhook'
      };
      const leads = (await kv.get(leadsKey)) || [];
      if (!leads.some((l) => l.id === leadEntry.id)) {
        leads.push(leadEntry);
        await kv.set(leadsKey, leads);
      }
      return res.status(200).json({ ok: true, type: 'lead' });
    }

    const tx = body.data && body.data.transaction;

    // ---- venda gerada (pendente) ----
    if (body.event === 'payment_created') {
      if (tx) {
        sendPush(
          user,
          '🟡 Venda gerada',
          customerName + ' · ' + (tx.plan_name || 'produto') + ' · R$ ' + Number(tx.amount || 0).toFixed(2).replace('.', ',')
        ).catch(() => {});
      }
      return res.status(200).json({ ok: true, type: 'created' });
    }

    // ---- venda aprovada ----
    if (body.event === 'payment_approved') {
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
        sendPush(
          user,
          '✅ Venda aprovada!',
          customerName + ' · R$ ' + entry.value.toFixed(2).replace('.', ',') + ' · ' + entry.desc
        ).catch(() => {});
      }

      return res.status(200).json({ ok: true, added: !alreadyExists });
    }

    // outros eventos que a plataforma mande e a gente ainda não trate
    return res.status(200).json({ ignored: true, event: body.event });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'método não permitido' });
}
