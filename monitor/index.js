import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { activityRules } from "../observacao.js";

const databaseURL = process.env.FIREBASE_DATABASE_URL;
if (!databaseURL) throw new Error("Defina FIREBASE_DATABASE_URL.");
const webhook = process.env.VETRECOVERY_WEBHOOK_URL;
if (webhook && new URL(webhook).protocol !== "https:") throw new Error("O webhook precisa usar HTTPS.");

const app = initializeApp({ databaseURL, credential: applicationDefault() });
const box = getDatabase(app).ref("vetrecovery/box01");
let state = (await box.child("atividade/estado").get()).val() ?? {};
let settings;
let queue = Promise.resolve();
function enqueue(operation) {
  queue = queue.then(operation).catch(error => {
    console.error("Falha no monitor:", error.code ?? error.name);
    process.exit(1);
  });
}

async function observe(data, now) {
  const uptime = data?.tempo_execucao_ms;
  const motion = data?.movimento;
  const valid = Number.isFinite(uptime) && uptime >= 0 && (motion === 0 || motion === 1);
  const previous = state.last;
  if (valid && previous?.uptime === uptime) return;
  if (!valid && !previous) return;
  const delta = uptime - previous?.uptime;
  const contiguous = valid && delta > 0 && delta <= 15000 && now - previous.at <= 15000;
  const rules = activityRules(settings);
  const starts = Object.values(state.starts ?? {}).filter(at => at >= now - 3600000);
  const updates = {};
  let active = state.active;
  if (active && (!contiguous || motion === 0)) {
    const { id, ...event } = active;
    updates[`atividade/movimentos/${id}`] = {
      ...event,
      duracao_ms: event.duracao_ms + (contiguous ? delta : 0),
      ultimo_em: contiguous ? now : event.ultimo_em,
      estado: contiguous ? "encerrada" : "interrompida"
    };
    active = null;
  }
  if (valid && motion === 1) {
    if (!active) {
      const partial = !contiguous;
      active = { id: box.child("atividade/movimentos").push().key, inicio_em: now, duracao_ms: 0, parcial: partial };
      if (!partial) starts.push(now);
    } else {
      active = { ...active, duracao_ms: active.duracao_ms + delta };
    }
    active = { ...active, ultimo_em: now, estado: "em_andamento" };
    const { id, ...event } = active;
    updates[`atividade/movimentos/${id}`] = event;
  }
  const count = starts.filter(at => at >= now - rules.janela_min * 60000).length;
  const patterns = {
    movimento_recorrente: valid && count >= rules.repeticoes,
    movimento_prolongado: (active?.duracao_ms ?? 0) >= rules.duracao_s * 1000
  };
  const episodes = { ...state.episodes };
  for (const [type, detected] of Object.entries(patterns)) {
    if (detected && !episodes[type]) {
      const id = box.child("ocorrencias").push().key;
      episodes[type] = id;
      updates[`ocorrencias/${id}`] = {
        tipo: type, estado: "em_andamento", box: "Box 01", dispositivo: "Monitor de telemetria",
        inicio_em: now, ultima_atualizacao_em: now,
        configuracao_revisao: settings?.revisao ?? "",
        regra: { ...rules, ativa: true }
      };
    } else if (episodes[type]) {
      const path = `ocorrencias/${episodes[type]}`;
      updates[`${path}/ultima_atualizacao_em`] = now;
      if (!detected) {
        updates[`${path}/estado`] = contiguous ? "encerrada" : "interrompida";
        if (contiguous) updates[`${path}/fim_em`] = now;
        delete episodes[type];
      }
    }
  }
  const next = { last: valid ? { uptime, at: now } : null, active, starts, episodes };
  updates["atividade/estado"] = next;
  updates["atividade/resumo"] = { count, janela_min: rules.janela_min, ...patterns, atualizado_em: now, disponivel: valid };
  await box.update(updates);
  state = next;
}

const config = box.child("configuracao");
settings = (await config.get()).val();
config.on("value", snapshot => { settings = snapshot.val(); }, error => enqueue(() => { throw error; }));
const telemetry = box.child("telemetria");
// The first value can be a retained sample from an offline device.
let first = true;
telemetry.on("value", snapshot => {
  const data = snapshot.val();
  const now = Date.now();
  enqueue(() => {
    if (first) {
      first = false;
      return;
    }
    return observe(data, now);
  });
}, error => enqueue(() => { throw error; }));
setInterval(() => enqueue(async () => {
  if (state.last && Date.now() - state.last.at > 15000) await observe(null, Date.now());
}), 5000);

if (webhook) {
  const enabledAt = await box.child("notificacoes_inicio_em").transaction(value => value ?? Date.now());
  const alerts = box.child("ocorrencias").orderByChild("inicio_em").startAt(enabledAt.snapshot.val());
  const pending = new Map();
  alerts.on("child_added", snapshot => {
    const event = snapshot.val();
    pending.set(snapshot.key, { tipo: event.tipo, inicio_em: event.inicio_em, box: "Box 01" });
  }, error => enqueue(() => { throw error; }));
  let sending = false;
  setInterval(async () => {
    if (sending) return;
    sending = true;
    try {
      for (const [id, event] of pending) {
        try {
          const delivery = box.child(`notificacoes_enviadas/${id}`);
          if (!(await delivery.get()).exists()) {
            const response = await fetch(webhook, {
              method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
              headers: { "Content-Type": "application/json", "Idempotency-Key": id },
              body: JSON.stringify({ id, ...event })
            });
            if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
            await delivery.set(Date.now());
          }
          pending.delete(id);
        } catch (error) {
          console.error("Entrega pendente:", id, error.name);
        }
      }
    } finally {
      sending = false;
    }
  }, 5000);
}
console.log("Monitor do Box 01 iniciado.");
