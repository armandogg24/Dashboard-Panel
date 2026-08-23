import admin from "firebase-admin";

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SA_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;

const resultados = [];
let fallos = 0;

function paso(nombre, ok, extra = "") {
  if (!ok) fallos++;
  resultados.push({ nombre, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${extra ? " — " + extra : ""}`);
}

for (const [nombre, valor] of [
  ["FIREBASE_SERVICE_ACCOUNT", SA_JSON],
  ["TELEGRAM_TOKEN", TOKEN],
  ["TELEGRAM_CHAT_ID", CHAT_ID]
]) {
  paso(`Secret ${nombre} presente`, Boolean(valor));
}

let base = null;
try {
  const credencial = JSON.parse(SA_JSON);
  admin.initializeApp({ credential: admin.credential.cert(credencial) });
  base = admin.firestore();
} catch (err) {
  paso("Firebase Admin inicializado", false, err.message);
}

if (base) {
  try {
    const refSalud = base.collection("_meta").doc("salud");
    await refSalud.set({ fecha: new Date().toISOString(), verificacion: true });
    const leido = await refSalud.get();
    await refSalud.delete();
    paso("Firestore escritura/lectura/borrado", leido.exists);
  } catch (err) {
    paso("Firestore escritura/lectura/borrado", false, err.message);
  }

  try {
    const subs = await base.collection("subscribers").get();
    console.log(`INFO  Colección subscribers: ${subs.size} documento(s)`);
    const config = await base.collection("config").doc("general").get();
    console.log(config.exists
      ? `INFO  Config actual: ${JSON.stringify(config.data())}`
      : "INFO  Config general aún no existe (se creará con valores por defecto al guardar en el panel)");
  } catch (err) {
    paso("Lectura de colecciones", false, err.message);
  }
}

if (TOKEN && CHAT_ID) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: "🤖 Verificación exitosa del panel de suscriptores. Las alertas llegarán aquí."
      })
    });
    const cuerpo = await res.json().catch(() => ({}));
    paso("Telegram sendMessage", res.ok && cuerpo.ok,
      cuerpo.description || (res.ok ? "" : `HTTP ${res.status}`));
  } catch (err) {
    paso("Telegram sendMessage", false, err.message);
  }
}

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} verificación(es) fallaron`);
process.exit(fallos === 0 ? 0 : 1);
