import {
  initApp, observarAuth, iniciarSesion, cerrarSesion,
  cargarSubscriptores, crearSuscriptor, guardarSuscriptor, eliminarSuscriptor,
  alternarCancelado, renovarSuscriptor, cargarReferidos,
  cargarConfig, guardarConfig,
  diasRestantes, addMeses, hoyISO, formatearFecha, estadoDe, sugerirCobro
} from "./db.js";
import { firebaseConfig, ADMIN_UID } from "./config.js";

const $ = (id) => document.getElementById(id);

const state = {
  subs: [],
  refs: [],
  filtro: "todos",
  busqueda: "",
  subEditando: null,
  subARenovar: null,
  config: null
};

const esPlaceholder = (v) => !v || String(v).startsWith("REEMPLAZA");
const esCancelado = (s) => s.estado_override === "cancelado";
const subsPorId = () => Object.fromEntries(state.subs.map(s => [s.id, s]));
const nombreDe = (id) => {
  const s = subsPorId()[id];
  return s ? s.nombre : "(eliminado)";
};

function toast(mensaje, tipo = "ok") {
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  t.textContent = mensaje;
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function validarConfiguracion() {
  const problemas = [];
  if (esPlaceholder(firebaseConfig.apiKey)) {
    problemas.push("Falta pegar tu <code>firebaseConfig</code> en <code>js/config.js</code> (guía 1.4).");
  }
  if (esPlaceholder(ADMIN_UID)) {
    problemas.push("Falta tu UID en <code>ADMIN_UID</code> de <code>js/config.js</code> y en <code>firestore.rules</code> (guía 1.2 y 3.2).");
  }
  if (problemas.length) {
    $("aviso-lista").innerHTML = problemas.map(p => `<li>${p}</li>`).join("");
    $("aviso-config").classList.remove("oculto");
  }
}

function mostrarLogin() {
  $("vista-login").classList.remove("oculto");
  $("app").classList.add("oculto");
}

async function entrarApp(usuario) {
  $("vista-login").classList.add("oculto");
  $("app").classList.remove("oculto");
  $("usuario-correo").textContent = usuario.email;
  await recargarDatos();
}

async function recargarDatos() {
  try {
    const [subs, refs, config] = await Promise.all([
      cargarSubscriptores(), cargarReferidos(), cargarConfig()
    ]);
    state.subs = subs;
    state.refs = refs;
    state.config = config;
    renderTodo();
  } catch (err) {
    console.error(err);
    if (String(err.code || "").includes("permission-denied")) {
      toast("Permiso denegado: verifica tu UID en firestore.rules y js/config.js", "err");
    } else {
      toast("Error cargando datos: " + err.message, "err");
    }
  }
}

function cambiarVista(nombre) {
  document.querySelectorAll(".seccion").forEach(s => s.classList.add("oculto"));
  $(`sec-${nombre}`).classList.remove("oculto");
  document.querySelectorAll("#nav-botones .tab").forEach(t =>
    t.classList.toggle("activo", t.dataset.vista === nombre));
}

function renderTodo() {
  renderDashboard();
  renderTabla();
  renderReferidos();
  renderConfigInputs();
}

function calcularMetricas() {
  let activos = 0, vencer = 0, vencidos = 0, saldoTotal = 0;
  for (const s of state.subs) {
    if (esCancelado(s)) continue;
    const d = diasRestantes(s.fecha_vencimiento);
    if (d > 7) activos++;
    else if (d >= 0) vencer++;
    else vencidos++;
    saldoTotal += s.descuento_acumulado || 0;
  }
  return { activos, vencer, vencidos, saldoTotal };
}

function renderDashboard() {
  const m = calcularMetricas();
  $("st-activos").textContent = m.activos;
  $("st-vencer").textContent = m.vencer;
  $("st-vencidos").textContent = m.vencidos;
  $("st-saldo").textContent = m.saldoTotal ? `+${m.saldoTotal}%` : "0%";

  const proximos = state.subs
    .filter(s => !esCancelado(s) && diasRestantes(s.fecha_vencimiento) >= 0)
    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
    .slice(0, 8);

  $("dash-vacio").classList.toggle("oculto", proximos.length > 0);
  $("lista-proximos").innerHTML = proximos.map(s => {
    const d = diasRestantes(s.fecha_vencimiento);
    const est = estadoDe(d);
    const saldo = s.descuento_acumulado
      ? `<span class="codigo-chip">saldo ${s.descuento_acumulado}%</span>` : "";
    const cuando = d === 0 ? "hoy" : `en ${d} día${d === 1 ? "" : "s"}`;
    return `<li><strong>${escapar(s.nombre)}</strong>
      <span class="badge ${est.cls}">${est.label}</span>${saldo}
      <span class="fecha">${formatearFecha(s.fecha_vencimiento)} · ${cuando}</span></li>`;
  }).join("");
}

function filtrarSubs() {
  const q = state.busqueda.trim().toLowerCase();
  return state.subs.filter(s => {
    const d = diasRestantes(s.fecha_vencimiento);
    const cancel = esCancelado(s);
    if (state.filtro === "porvencer" && (cancel || d < 0 || d > 7)) return false;
    if (state.filtro === "vencidos" && (cancel || d >= 0)) return false;
    if (state.filtro === "cancelados" && !cancel) return false;
    if (q && !(s.nombre.toLowerCase().includes(q) ||
        (s.referral_code || "").toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function renderTabla() {
  const lista = filtrarSubs();
  $("tb-subs").innerHTML = lista.map(s => {
    const d = diasRestantes(s.fecha_vencimiento);
    const est = esCancelado(s)
      ? { key: "cancelado", label: "Cancelado", cls: "b-cancelado" }
      : estadoDe(d);
    const refBy = s.referred_by ? escapar(nombreDe(s.referred_by)) : "—";
    const saldo = s.descuento_acumulado
      ? `<span class="saldo-chip">${s.descuento_acumulado}%</span>` : '<span class="muted">0%</span>';
    const accionCancel = esCancelado(s)
      ? { acc: "reactivar", txt: "Reactivar" }
      : { acc: "cancelar", txt: "Cancelar" };
    return `<tr><td><strong>${escapar(s.nombre)}</strong><br>
      <span class="codigo-chip">${s.referral_code}</span></td>
      <td>${escapar(s.plan || "—")}</td>
      <td>${formatearFecha(s.fecha_vencimiento)}</td>
      <td><span class="badge ${est.cls}">${est.label}</span></td>
      <td>${refBy}</td>
      <td>${saldo}</td>
      <td><div class="acciones">
        <button class="btn btn-mini" data-accion="editar" data-id="${s.id}">Editar</button>
        <button class="btn btn-mini btn-primario" data-accion="renovar" data-id="${s.id}">Renovar</button>
        <button class="btn btn-mini btn-fantasma" data-accion="${accionCancel.acc}" data-id="${s.id}">${accionCancel.txt}</button>
        <button class="btn btn-mini btn-peligro" data-accion="borrar" data-id="${s.id}">Borrar</button>
      </div></td></tr>`;
  }).join("");
  $("cont-subs").textContent = `${lista.length} de ${state.subs.length} suscriptores`;
}

function renderReferidos() {
  $("tb-refs").innerHTML = state.refs.map(r => `
    <tr><td>${formatearFecha(r.fecha)}</td>
    <td>${escapar(nombreDe(r.referente))}</td>
    <td>${saldoVigente(r.referente)}</td>
    <td>${escapar(nombreDe(r.referido))}</td>
    <td>${r.porcentaje}%</td></tr>`).join("");
  $("refs-vacio").classList.toggle("oculto", state.refs.length > 0);

  const conteo = {};
  for (const r of state.refs) conteo[r.referente] = (conteo[r.referente] || 0) + 1;
  const top = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("top-refs").innerHTML = top.map(([id, n]) => {
    const s = subsPorId()[id];
    const saldo = s ? (s.descuento_acumulado || 0) : null;
    return `<li><span>${escapar(s ? s.nombre : "(eliminado)")}</span>
      <span>${n} referido${n === 1 ? "" : "s"}
      ${saldo !== null ? `· <span class="saldo-chip">${saldo}%</span>` : ""}</span></li>`;
  }).join("") || '<li class="muted">Sin datos aún.</li>';
}

function saldoVigente(id) {
  const s = subsPorId()[id];
  return s ? `<span class="saldo-chip">${s.descuento_acumulado || 0}%</span>` : "—";
}

function renderConfigInputs() {
  if (!state.config) return;
  $("cfg-porcentaje").value = state.config.porcentaje_por_referido;
  $("cfg-tope").value = state.config.tope_maximo;
  $("cfg-nota").textContent =
    `Regla vigente: cada referido exitoso suma ${state.config.porcentaje_por_referido}% al referente, con tope de ${state.config.tope_maximo}%.`;
}

function abrirDialogoNuevo() {
  state.subEditando = null;
  $("dlg-sub-titulo").textContent = "Nuevo suscriptor";
  $("f-nombre").value = "";
  $("f-plan").value = "";
  $("f-precio").value = "";
  $("f-inicio").value = hoyISO();
  $("f-fin").value = addMeses(hoyISO(), 1);
  $("f-codigo").value = "";
  $("grupo-codigo").classList.remove("oculto");
  $("sub-error").classList.add("oculto");
  $("dlg-sub").showModal();
}

function abrirDialogoEditar(sub) {
  state.subEditando = sub.id;
  $("dlg-sub-titulo").textContent = "Editar suscriptor";
  $("f-nombre").value = sub.nombre;
  $("f-plan").value = sub.plan || "";
  $("f-precio").value = sub.precio ?? "";
  $("f-inicio").value = sub.fecha_inicio;
  $("f-fin").value = sub.fecha_vencimiento;
  $("grupo-codigo").classList.add("oculto");
  $("sub-error").classList.add("oculto");
  $("dlg-sub").showModal();
}

function actualizarCobroSugerido() {
  const s = state.subARenovar;
  if (!s) return;
  const meses = Math.max(1, parseInt($("r-meses").value, 10) || 1);
  const saldo = s.descuento_acumulado || 0;
  const cobro = sugerirCobro(s.precio, meses, saldo);
  $("r-cobro").textContent = s.precio > 0
    ? `Precio $${s.precio} × ${meses} mes(es) − ${saldo}% ⇒ cobro sugerido: $${cobro}`
    : "Sin precio definido: el descuento quedará registrado solo como historial.";
}

function abrirDialogoRenovar(sub) {
  state.subARenovar = sub;
  $("r-info").innerHTML =
    `<strong>${escapar(sub.nombre)}</strong>
     <span>Vence: ${formatearFecha(sub.fecha_vencimiento)} · saldo de referidos: ${sub.descuento_acumulado || 0}%</span>`;
  $("r-meses").value = 1;
  actualizarCobroSugerido();
  $("dlg-renovar").showModal();
}

function escapar(txt) {
  return String(txt ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function conectarEventos() {
  document.querySelectorAll("#nav-botones .tab")
    .forEach(t => t.addEventListener("click", () => cambiarVista(t.dataset.vista)));

  $("btn-salir").addEventListener("click", () => cerrarSesion());

  $("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("login-error");
    err.classList.add("oculto");
    $("btn-login").disabled = true;
    try {
      await iniciarSesion($("login-correo").value.trim(), $("login-clave").value);
    } catch (ex) {
      const mapa = {
        "auth/invalid-credential": "Correo o contraseña incorrectos.",
        "auth/user-not-found": "Correo o contraseña incorrectos.",
        "auth/wrong-password": "Correo o contraseña incorrectos.",
        "auth/too-many-requests": "Demasiados intentos. Espera unos minutos."
      };
      err.textContent = mapa[ex.code] || "Error: " + ex.message;
      err.classList.remove("oculto");
    } finally {
      $("btn-login").disabled = false;
    }
  });

  $("busqueda").addEventListener("input", (e) => {
    state.busqueda = e.target.value;
    renderTabla();
  });

  document.querySelectorAll("#chips .chip").forEach(c =>
    c.addEventListener("click", () => {
      state.filtro = c.dataset.filtro;
      document.querySelectorAll("#chips .chip").forEach(x =>
        x.classList.toggle("activo", x === c));
      renderTabla();
    }));

  $("btn-nuevo").addEventListener("click", abrirDialogoNuevo);

  $("tb-subs").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-accion]");
    if (!btn) return;
    const sub = subsPorId()[btn.dataset.id];
    if (!sub) return;
    const accion = btn.dataset.accion;
    try {
      if (accion === "editar") abrirDialogoEditar(sub);
      else if (accion === "renovar") abrirDialogoRenovar(sub);
      else if (accion === "borrar") {
        if (!confirm(`¿Eliminar a "${sub.nombre}"? No se puede deshacer.`)) return;
        btn.disabled = true;
        await eliminarSuscriptor(sub.id);
        toast("Suscriptor eliminado.");
        await recargarDatos();
      } else if (accion === "cancelar" || accion === "reactivar") {
        btn.disabled = true;
        await alternarCancelado(sub);
        toast(accion === "cancelar" ? "Suscripción cancelada." : "Suscripción reactivada.");
        await recargarDatos();
      }
    } catch (err) {
      toast("Error: " + err.message, "err");
      btn.disabled = false;
    }
  });

  document.querySelectorAll("[data-cerrar]").forEach(b =>
    b.addEventListener("click", () => b.closest("dialog").close()));

  $("form-sub").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("sub-error");
    errEl.classList.add("oculto");

    const datos = {
      nombre: $("f-nombre").value.trim(),
      plan: $("f-plan").value.trim() || "",
      precio: $("f-precio").value === "" ? null : Number($("f-precio").value),
      fecha_inicio: $("f-inicio").value,
      fecha_vencimiento: $("f-fin").value
    };

    if (!datos.nombre) return mostrarErrorSub("El nombre es obligatorio.");
    if (!datos.fecha_inicio || !datos.fecha_vencimiento)
      return mostrarErrorSub("Las fechas son obligatorias.");
    if (datos.fecha_vencimiento <= datos.fecha_inicio)
      return mostrarErrorSub("El vencimiento debe ser posterior al inicio.");

    const btn = $("btn-guardar-sub");
    btn.disabled = true;
    try {
      if (state.subEditando) {
        await guardarSuscriptor(state.subEditando, datos);
        toast("Cambios guardados.");
      } else {
        const creado = await crearSuscriptor(datos, $("f-codigo").value);
        toast(`Suscriptor creado · su código de referido es ${creado.codigo}`);
      }
      $("dlg-sub").close();
      await recargarDatos();
    } catch (ex) {
      mostrarErrorSub(ex.message);
    } finally {
      btn.disabled = false;
    }

    function mostrarErrorSub(msg) {
      errEl.textContent = msg;
      errEl.classList.remove("oculto");
    }
  });

  $("r-meses").addEventListener("input", actualizarCobroSugerido);

  $("form-renovar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sub = state.subARenovar;
    if (!sub) return;
    const meses = Math.max(1, parseInt($("r-meses").value, 10) || 1);
    const btn = $("btn-confirmar-renovar");
    btn.disabled = true;
    try {
      const res = await renovarSuscriptor(sub, meses);
      $("dlg-renovar").close();
      let msg = `Renovado hasta ${formatearFecha(res.nuevoVencimiento)}.`;
      if (res.saldo > 0) msg += ` Se aplicó ${res.saldo}% (saldo reiniciado).`;
      if (res.cobroSugerido != null) msg += ` Cobro sugerido: $${res.cobroSugerido}`;
      toast(msg);
      await recargarDatos();
    } catch (ex) {
      toast("Error al renovar: " + ex.message, "err");
    } finally {
      btn.disabled = false;
    }
  });

  $("form-config").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pct = Math.min(100, Math.max(1, parseInt($("cfg-porcentaje").value, 10)));
    const tope = Math.min(100, Math.max(1, parseInt($("cfg-tope").value, 10)));
    if (tope < pct) return toast("El tope no puede ser menor que el % por referido.", "err");
    try {
      state.config = await guardarConfig({ porcentaje_por_referido: pct, tope_maximo: tope });
      renderConfigInputs();
      toast("Configuración guardada.");
    } catch (ex) {
      toast("Error: " + ex.message, "err");
    }
  });
}

validarConfiguracion();
initApp(firebaseConfig);
conectarEventos();

observarAuth(async (usuario) => {
  if (!usuario) return mostrarLogin();
  if (!esPlaceholder(ADMIN_UID) && usuario.uid !== ADMIN_UID) {
    await cerrarSesion();
    const err = $("login-error");
    err.textContent = "Esta cuenta no es el administrador configurado.";
    err.classList.remove("oculto");
    return mostrarLogin();
  }
  await entrarApp(usuario);
});
