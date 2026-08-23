import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache,
  persistentMultipleTabManager, collection, doc, getDoc, getDocs,
  addDoc, setDoc, updateDoc, deleteDoc, query, where, limit,
  serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ADMIN_UID } from "./config.js";

const COL_SUBS = "subscribers";
const COL_REFS = "referrals";
const COL_VEND = "vendedores";

let _db = null;
let _auth = null;
let _uid = null;
let _rol = null;
let _config = null;

function iniciarFirestore(app) {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
  } catch (err) {
    console.warn("Persistencia offline no disponible:", err.message);
    return getFirestore(app);
  }
}

export function initApp(firebaseConfig) {
  const app = initializeApp(firebaseConfig);
  _db = iniciarFirestore(app);
  _auth = getAuth(app);
}

export function observarAuth(cb) { return onAuthStateChanged(_auth, cb); }
export function iniciarSesion(correo, clave) { return signInWithEmailAndPassword(_auth, correo, clave); }
export async function cerrarSesion() {
  _rol = null;
  _uid = null;
  await signOut(_auth);
}

export async function detectarRol(usuario) {
  _uid = usuario.uid;
  const snap = await getDoc(doc(_db, COL_VEND, usuario.uid));
  if (snap.exists()) {
    _rol = snap.data().activo === false ? "suspendido" : "vendedor";
    return _rol;
  }
  if (usuario.uid === ADMIN_UID) {
    _rol = "admin";
    return "admin";
  }
  _rol = "nulo";
  return null;
}

export function obtenerRol() { return _rol; }
export function uidActual() { return _uid; }

export function hoyISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}

export function diasRestantes(fechaISO) {
  const [a1, m1, d1] = hoyISO().split("-").map(Number);
  const [a2, m2, d2] = fechaISO.split("-").map(Number);
  const t1 = Date.UTC(a1, m1 - 1, d1);
  const t2 = Date.UTC(a2, m2 - 1, d2);
  return Math.round((t2 - t1) / 864e5);
}

export function addMeses(fechaISO, meses) {
  let [a, m, d] = fechaISO.split("-").map(Number);
  const total = (m - 1) + meses;
  a += Math.floor(total / 12);
  m = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  d = Math.min(d, ultimoDia);
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function formatearFecha(iso) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function estadoDe(dias) {
  if (dias < 0) return { key: "vencido", label: "Vencido", cls: "b-vencido" };
  if (dias === 0) return { key: "hoy", label: "Vence hoy", cls: "b-hoy" };
  if (dias <= 3) return { key: "critico", label: `${dias} d`, cls: "b-critico" };
  if (dias <= 7) return { key: "proximo", label: `${dias} d`, cls: "b-proximo" };
  return { key: "activo", label: "Activo", cls: "b-activo" };
}

export function sugerirCobro(precio, meses, saldoPct) {
  if (!precio || precio <= 0) return null;
  const bruto = precio * meses;
  return Math.round(bruto * (1 - (saldoPct || 0) / 100) * 100) / 100;
}

function generarCodigo() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += abc[Math.floor(Math.random() * abc.length)];
  return c;
}

const subsRef = () => collection(_db, COL_SUBS);
const refsRef = () => collection(_db, COL_REFS);
const vendRef = () => collection(_db, COL_VEND);

async function consultarSubscriptores() {
  if (_rol === "admin") return getDocs(subsRef());
  return getDocs(query(subsRef(), where("vendedor_id", "==", _uid)));
}

export async function buscarPorCodigo(codigo) {
  const buscado = (codigo || "").trim().toUpperCase();
  if (!buscado) return null;
  const q = _rol === "admin"
    ? query(subsRef(), where("referral_code", "==", buscado), limit(1))
    : query(
        subsRef(),
        where("vendedor_id", "==", _uid),
        where("referral_code", "==", buscado),
        limit(1)
      );
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0];
}

async function asegurarConfig() {
  if (!_config) {
    const snap = await getDoc(doc(_db, "config", "general"));
    _config = snap.exists()
      ? snap.data()
      : { porcentaje_por_referido: 10, tope_maximo: 100 };
  }
  return _config;
}

export async function cargarConfig() {
  await asegurarConfig();
  return { ..._config };
}

export async function guardarConfig(nueva) {
  await setDoc(doc(_db, "config", "general"), nueva, { merge: true });
  _config = { ..._config, ...nueva };
  return _config;
}

export async function cargarSubscriptores() {
  const snap = await consultarSubscriptores();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function cargarVendedores() {
  const snap = await getDocs(vendRef());
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
}

export async function crearVendedorDoc(datos) {
  await setDoc(doc(vendRef(), datos.uid), {
    nombre: datos.nombre.trim(),
    email: datos.email.trim(),
    telegram_chat_id: datos.telegram_chat_id?.trim() || null,
    activo: true,
    creado: serverTimestamp()
  });
}

export async function guardarVendedor(uid, campos) {
  await updateDoc(doc(vendRef(), uid), campos);
}

export async function alternarVendedor(v) {
  await updateDoc(doc(vendRef(), v.id), { activo: !v.activo });
  return !v.activo;
}

export async function eliminarVendedor(uid) {
  await deleteDoc(doc(vendRef(), uid));
}

export async function crearSuscriptor(datos, codigoReferido) {
  let referente = null;
  const codigo = (codigoReferido || "").trim().toUpperCase();
  if (codigo) {
    referente = await buscarPorCodigo(codigo);
    if (!referente) throw new Error("Código de referido no válido");
  }

  let nuevoCodigo = generarCodigo();
  for (let i = 0; i < 6; i++) {
    if (!(await buscarPorCodigo(nuevoCodigo))) break;
    nuevoCodigo = generarCodigo();
  }

  const vendedorAsignado = _rol === "admin" ? "admin" : _uid;

  const refNuevo = await addDoc(subsRef(), {
    ...datos,
    vendedor_id: vendedorAsignado,
    referral_code: nuevoCodigo,
    referred_by: referente ? referente.id : null,
    descuento_acumulado: 0,
    notificados: [],
    telegram_chat_id: null,
    historial: [],
    estado_override: null,
    creado: serverTimestamp(),
    actualizado: serverTimestamp()
  });

  if (referente) {
    const cfg = await asegurarConfig();
    const rData = referente.data();
    await addDoc(refsRef(), {
      referente: referente.id,
      referido: refNuevo.id,
      codigo_usado: codigo,
      porcentaje: cfg.porcentaje_por_referido,
      fecha: hoyISO()
    });
    await updateDoc(referente.ref, {
      descuento_acumulado: Math.min(
        (rData.descuento_acumulado || 0) + cfg.porcentaje_por_referido,
        cfg.tope_maximo
      ),
      actualizado: serverTimestamp()
    });
  }

  return { id: refNuevo.id, codigo: nuevoCodigo };
}

export async function guardarSuscriptor(id, datos) {
  await updateDoc(doc(_db, COL_SUBS, id), { ...datos, actualizado: serverTimestamp() });
}

export async function eliminarSuscriptor(id) {
  await deleteDoc(doc(_db, COL_SUBS, id));
}

export async function alternarCancelado(sub) {
  const nuevo = sub.estado_override === "cancelado" ? null : "cancelado";
  await updateDoc(doc(_db, COL_SUBS, sub.id), {
    estado_override: nuevo,
    actualizado: serverTimestamp()
  });
  return nuevo;
}

export async function renovarSuscriptor(sub, meses) {
  const base = hoyISO() > sub.fecha_vencimiento ? hoyISO() : sub.fecha_vencimiento;
  const nuevoVencimiento = addMeses(base, meses);
  const saldo = sub.descuento_acumulado || 0;
  const cobroSugerido = sugerirCobro(sub.precio, meses, saldo);

  await updateDoc(doc(_db, COL_SUBS, sub.id), {
    fecha_vencimiento: nuevoVencimiento,
    descuento_acumulado: 0,
    notificados: [],
    historial: arrayUnion({
      tipo: "renovacion",
      fecha: hoyISO(),
      meses,
      descuento_aplicado: saldo
    }),
    actualizado: serverTimestamp()
  });

  return { nuevoVencimiento, saldo, cobroSugerido };
}

export async function cargarReferidos() {
  const snap = await getDocs(refsRef());
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
}
