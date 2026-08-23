import admin from "firebase-admin";

const UMBRALES = [
  { dias: 7, etiqueta: "7d", texto: "7 días" },
  { dias: 3, etiqueta: "3d", texto: "3 días" },
  { dias: 1, etiqueta: "1d", texto: "1 día" }
];

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT = process.env.TELEGRAM_CHAT_ID;
const SA_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;

for (const [nombre, valor] of [
  ["FIREBASE_SERVICE_ACCOUNT", SA_JSON],
  ["TELEGRAM_TOKEN", TOKEN],
  ["TELEGRAM_CHAT_ID", ADMIN_CHAT]
]) {
  if (!valor) {
    console.error(`Falta el secret ${nombre}`);
    process.exit(1);
  }
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

function diasRestantes(fechaISO) {
  const [a1, m1, d1] = hoyISO().split("-").map(Number);
  const [a2, m2, d2] = fechaISO.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 864e5);
}

const escapar = (t) =>
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function enviarTelegram(chatId, texto) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: texto,
          parse_mode: "HTML",
          disable_web_page_preview: true
        })
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (res.ok && cuerpo.ok) return true;
      throw new Error(`HTTP ${res.status}: ${cuerpo.description || "sin detalle"}`);
    } catch (err) {
      if (intento === 2) {
        console.error(`   Error enviando a ${chatId}: ${err.message}`);
        return false;
      }
      await dormir(1500);
    }
  }
  return false;
}

try {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(SA_JSON))
  });
} catch (err) {
  console.error("El secret FIREBASE_SERVICE_ACCOUNT no es un JSON válido:", err.message);
  process.exit(1);
}

const base = admin.firestore();
const hoy = hoyISO();

const snapVend = await base.collection("vendedores").get();
const vendedores = new Map(
  snapVend.docs.map(d => [d.id, { ...d.data(), id: d.id }])
);

const snap = await base.collection("subscribers").get();
let enviados = 0, fallidos = 0, omitidos = 0;
const detalle = [];

async function entregar(chats, texto) {
  const destinos = [...new Set(chats.filter(Boolean))];
  let ok = false;
  const fallosDestino = [];
  for (const chat of destinos) {
    const logrado = await enviarTelegram(chat, texto);
    if (logrado) ok = true;
    else fallosDestino.push(chat);
    await dormir(400);
  }
  return { ok, fallosDestino };
}

for (const docRef of snap.docs) {
  const sub = docRef.data();
  const nombre = sub.nombre || "(sin nombre)";

  if (sub.estado_override === "cancelado") continue;
  if (!sub.fecha_vencimiento) continue;

  const dias = diasRestantes(sub.fecha_vencimiento);
  const umbral = UMBRALES.find(u => u.dias === dias);
  if (!umbral) continue;

  const notificados = Array.isArray(sub.notificados) ? sub.notificados : [];
  if (notificados.includes(umbral.etiqueta)) {
    omitidos++;
    detalle.push(`- ⏭️ \`${escapar(nombre)}\` · aviso de ${umbral.texto} ya enviado`);
    continue;
  }

  const vid = sub.vendedor_id || "admin";
  const vend = vid === "admin" ? null : vendedores.get(vid);
  const nombreVendedor = vid === "admin"
    ? "Panel (admin)"
    : (vend ? `${vend.nombre}` : `vendedor ${vid}`);

  const saldo = sub.descuento_acumulado || 0;
  let texto =
    `📅 <b>Suscripción por vencer</b>\n\n` +
    `👤 <b>${escapar(nombre)}</b>\n` +
    `🗓 Vence: <b>${sub.fecha_vencimiento}</b>\n` +
    `⏳ Faltan: <b>${umbral.texto}</b>` +
    `\n🏪 Vendedor: ${escapar(nombreVendedor)}`;
  if (sub.plan) texto += `\n📦 Plan: ${escapar(sub.plan)}`;
  if (saldo > 0) texto += `\n🎁 Saldo por referidos: <b>${saldo}%</b>`;

  const chats = [ADMIN_CHAT];
  if (vend && vend.activo !== false && vend.telegram_chat_id) {
    chats.push(vend.telegram_chat_id);
  }

  const { ok, fallosDestino } = await entregar(chats, texto);

  if (ok) {
    await docRef.ref.update({
      notificados: admin.firestore.FieldValue.arrayUnion(umbral.etiqueta)
    });
    enviados++;
    const extra = fallosDestino.length
      ? ` ⚠️ falló destino: ${fallosDestino.join(", ")}`
      : "";
    detalle.push(`- ✅ \`${escapar(nombre)}\` · ${umbral.texto}${extra}`);
    console.log(`Enviado: ${nombre} (${umbral.texto})`);
    if (fallosDestino.length) fallidos++;
  } else {
    fallidos++;
    detalle.push(`- ❌ \`${escapar(nombre)}\` · fallo al enviar`);
  }

  await dormir(400);
}

const resumen =
  `Suscriptores revisados: ${snap.size}\n` +
  `Avisos procesados: ${enviados} · Omitidos (ya avisados): ${omitidos} · Con fallos: ${fallidos}`;
console.log("\n" + resumen);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md =
    `## Resumen de notificaciones (${hoy})\n\n` +
    `| Revisados | Enviados | Omitidos | Con fallos |\n|---|---|---|---|\n` +
    `| ${snap.size} | ${enviados} | ${omitidos} | ${fallidos} |\n\n` +
    (detalle.length ? detalle.join("\n") : "_Nada que notificar hoy._") + "\n";
  const fs = await import("node:fs");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

process.exit(fallidos > 0 ? 1 : 0);
