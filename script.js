/* ============================================================
   NOIR & BLADE — script.js  (v3)
   ► Smart time filtering (past/booked slots auto-disabled)
   ► Supabase — reservas guardadas en la nube en tiempo real
   ► localStorage — fallback si Supabase no está configurado
   ► EmailJS  — correo de confirmación al cliente
   ============================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   ██  EMAILJS
   ────────────────────────────────────────────────────────────── */
const EMAILJS_CONFIG = {
  publicKey: 'HvIa6Fo7CaG8Assxu',
  serviceId: 'service_c1pe70s',
  templateId: 'template_27h4qdr',
};
emailjs.init(EMAILJS_CONFIG.publicKey);

/* ──────────────────────────────────────────────────────────────
   ██  SUPABASE
   Pega aquí tu Project URL y Anon Key desde:
   Supabase Dashboard → Settings → API
   ────────────────────────────────────────────────────────────── */
const SUPABASE_URL = 'https://hgxayxrszmcmmrrwxlxz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0';

const SUPABASE_ON = SUPABASE_URL !== 'PENDING' && SUPABASE_KEY !== 'PENDING';
const sb = SUPABASE_ON ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

/* ──────────────────────────────────────────────────────────────
   STORAGE HELPERS
   Supabase si está configurado, localStorage de fallback.
   ────────────────────────────────────────────────────────────── */
const LS_KEY = 'nb_bookings';

function lsGetAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}
function lsSave(b) {
  const all = lsGetAll(); all.push(b);
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

/* Points per service (partial match, case-insensitive) */
const POINTS_MAP = [
  { keyword: 'premium', pts: 20 },
  { keyword: 'combo', pts: 15 },
  { keyword: 'corte', pts: 10 },
  { keyword: 'barba', pts: 8 },
];
function getPointsForService(serviceName) {
  const s = (serviceName || '').toLowerCase();
  for (const { keyword, pts } of POINTS_MAP) {
    if (s.includes(keyword)) return pts;
  }
  return 10; // default
}

/** Insert booking and link to client. Returns { ok, bookingId, collision } */
async function persistBooking(booking) {
  if (SUPABASE_ON) {
    const { data, error } = await sb.from('bookings').insert([{
      name: booking.name,
      phone: booking.phone,
      email: booking.email,
      notes: booking.notes,
      service: booking.service,
      price: booking.price,
      duration: booking.duration,
      date: booking.date,
      time: booking.time,
      barber: booking.barber,
    }]).select('id').single();
    
    if (error) { 
      if (error.code === '23505') { return { ok: false, collision: true }; }
      console.warn('Supabase insert error, falling back to LS:', error); 
      lsSave(booking); 
      return { ok: false, error }; 
    }
    return { ok: true, bookingId: data?.id };
  }
  lsSave(booking);
  return { ok: true };
}

/**
 * Upsert client by phone number.
 * Creates new client or updates name/email on existing one.
 * Links the booking to the client.
 */
async function upsertClient(booking, bookingId) {
  if (!SUPABASE_ON) return;
  try {
    // Check if client already exists
    const { data: existing } = await sb
      .from('clients')
      .select('id, name, email')
      .eq('phone', booking.phone)
      .maybeSingle();

    let clientId;
    if (existing) {
      clientId = existing.id;
      // Update name/email if improved
      await sb.from('clients').update({
        name: booking.name || existing.name,
        email: booking.email || existing.email,
        rut: booking.rut || existing.rut,
        updated_at: new Date().toISOString(),
      }).eq('id', clientId);
    } else {
      const { data: newClient } = await sb.from('clients').insert({
        name: booking.name,
        phone: booking.phone,
        email: booking.email || null,
        rut: booking.rut || null,
        points: 0,
        total_visits: 0,
      }).select('id').single();
      clientId = newClient?.id;
    }

    // Link booking → client
    if (bookingId && clientId) {
      await sb.from('bookings').update({ client_id: clientId }).eq('id', bookingId);
    }
  } catch (err) {
    console.warn('upsertClient error (non-critical):', err);
  }
}

/**
 * Returns array of booked time strings for a given date label AND barber
 */
async function getBookedTimesForBarber(dateStr, barberName) {
  if (SUPABASE_ON) {
    const { data, error } = await sb
      .from('bookings')
      .select('time')
      .eq('date', dateStr)
      .eq('barber', barberName);
    if (error) { console.warn('Supabase select error:', error); }
    return (data || []).map(r => r.time);
  }
  return lsGetAll().filter(b => b.date === dateStr && b.barber === barberName).map(b => b.time);
}

/**
 * Returns barber blocks for a given JS Date object.
 * Each block: { barber_name, block_type, start_time?, end_time? }
 */
async function getBarberBlocksForDate(dateObj) {
  if (!SUPABASE_ON || !dateObj) return [];
  const iso = dateObj.toLocaleDateString('en-CA'); // "YYYY-MM-DD"
  const { data, error } = await sb
    .from('barber_blocks')
    .select('barber_name, block_type, start_time, end_time')
    .eq('block_date', iso);
  if (error) { console.warn('Blocks fetch error:', error); return []; }
  return data || [];
}

/* ──────────────────────────────────────────────────────────────
   NAV SCROLL
   ────────────────────────────────────────────────────────────── */
const nav = document.getElementById('main-nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

/* ──────────────────────────────────────────────────────────────
   SERVICE TABS
   ────────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.service-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
    document.getElementById('panel-' + btn.dataset.tab)?.classList.add('active');
  });
});

/* ──────────────────────────────────────────────────────────────
   STATE
   ────────────────────────────────────────────────────────────── */
const state = {
  service: null, price: null, duration: null,
  date: null,    // display string e.g. "Lun 9 mar"
  dateObj: null, // Date object
  time: null,
  barber: null,
};

const BARBERS = [
  'Emanuel',
  'Matías Nuñez',
  'Ángel',
  'Benjamín',
  'Gonzalo'
];
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function updateSummary() {
  document.getElementById('sum-service').textContent = state.service || '—';
  document.getElementById('sum-price').textContent = state.price || '—';
  const ph = t => `<span class="summary-placeholder">${t}</span>`;
  document.getElementById('sum-date').innerHTML = state.date ? state.date : ph('Sin seleccionar');
  document.getElementById('sum-time').innerHTML = state.time ? state.time : ph('Sin seleccionar');
  document.getElementById('sum-duration').innerHTML = state.duration ? state.duration : ph('—');
  document.getElementById('sum-barber').innerHTML = state.barber ? state.barber : ph('Sin seleccionar');
}

/* ──────────────────────────────────────────────────────────────
   TIME FILTERING
   ────────────────────────────────────────────────────────────── */
function parseHM(str) { const [h, m] = str.split(':').map(Number); return h * 60 + m; }

async function refreshTimePills() {
  const pills = document.querySelectorAll('.time-pill');
  const now = new Date();
  const isToday = state.dateObj &&
    state.dateObj.getFullYear() === now.getFullYear() &&
    state.dateObj.getMonth() === now.getMonth() &&
    state.dateObj.getDate() === now.getDate();

  // Fetch booked times for specific barber
  const bookedTimes = state.date && state.barber ? await getBookedTimesForBarber(state.date, state.barber) : [];
  
  // Fetch barber blocks to see if they are in lunch / day off
  const blocks = state.dateObj ? await getBarberBlocksForDate(state.dateObj) : [];
  const fullDayBlock = blocks.find(b => b.barber_name === state.barber && b.block_type === 'full_day');
  const hourBlock = blocks.find(b => b.barber_name === state.barber && b.block_type === 'hours');

  const nowMin = now.getHours() * 60 + now.getMinutes() + 45; // 45-min buffer

  pills.forEach(pill => {
    const t = pill.dataset.time;
    if (!t) return;

    pill.classList.remove('past', 'booked', 'selected', 'busy');

    // 0. Full day blocks
    if (fullDayBlock) {
      pill.classList.add('busy'); pill.disabled = true;
      pill.setAttribute('aria-label', `${t} — No disponible`);
      return;
    }

    // 0.5. Hour blocks
    if (hourBlock && hourBlock.start_time && hourBlock.end_time) {
      function hm(ts) { const [h, m] = ts.split(':').map(Number); return h * 60 + m; }
      const thisMin = hm(t);
      if (thisMin >= hm(hourBlock.start_time) && thisMin < hm(hourBlock.end_time)) {
        pill.classList.add('busy'); pill.disabled = true;
        pill.setAttribute('aria-label', `${t} — Bloqueado`);
        return;
      }
    }

    // 1. Already booked
    if (bookedTimes.includes(t)) {
      pill.classList.add('busy'); pill.disabled = true;
      pill.setAttribute('aria-label', `${t} — Reservado`);
      return;
    }
    // 2. Past time today
    if (isToday && parseHM(t) <= nowMin) {
      pill.classList.add('busy', 'past'); pill.disabled = true;
      pill.setAttribute('aria-label', `${t} — No disponible`);
      return;
    }
    // 3. Available
    pill.classList.remove('busy'); pill.disabled = false;
    pill.setAttribute('aria-label', t);
  });

  // Deselect if current choice became unavailable
  if (state.time) {
    const sel = document.querySelector(`.time-pill[data-time="${state.time}"]`);
    if (!sel || sel.classList.contains('busy')) { state.time = null; updateSummary(); }
    else sel.classList.add('selected');
  }
}

/* ──────────────────────────────────────────────────────────────
   DAY PICKER
   ────────────────────────────────────────────────────────────── */
function buildDayPicker() {
  const picker = document.getElementById('day-picker');
  picker.innerHTML = '';
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const sun = d.getDay() === 0;
    const lbl = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

    const pill = document.createElement('button');
    pill.className = 'day-pill' + (i === 0 ? ' selected' : '') + (sun ? ' disabled' : '');
    pill.disabled = sun;
    pill.setAttribute('role', 'listitem');
    pill.setAttribute('aria-label', lbl + (sun ? ' — Cerrado' : ''));
    pill.innerHTML = `<span>${DAYS[d.getDay()]}</span>
      <span class="day-num">${d.getDate()}</span>
      <span style="font-size:0.62rem;color:var(--grey-60)">${MONTHS[d.getMonth()]}</span>`;

    if (!sun) {
      pill.addEventListener('click', async () => {
        picker.querySelectorAll('.day-pill').forEach(p => p.classList.remove('selected'));
        pill.classList.add('selected');
        state.date = lbl; state.dateObj = d;
        updateSummary();
        refreshTimePills();
      });
    }

    if (i === 0) { state.date = lbl; state.dateObj = d; }
    picker.appendChild(pill);
  }
  refreshTimePills();
  updateSummary();
}

/* ──────────────────────────────────────────────────────────────
   TIME PILLS — click
   ────────────────────────────────────────────────────────────── */
document.querySelectorAll('.time-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    if (pill.classList.contains('busy') || pill.disabled) return;
    document.querySelectorAll('.time-pill').forEach(p => p.classList.remove('selected'));
    pill.classList.add('selected');
    state.time = pill.dataset.time;
    updateSummary();
  });
});

/* ──────────────────────────────────────────────────────────────
   MODAL OPEN / CLOSE
   ────────────────────────────────────────────────────────────── */
const modal = document.getElementById('booking-modal');
const backdrop = document.getElementById('modal-backdrop');
const closeBtn = document.getElementById('modal-close-btn');

function openModal(serviceData) {
  if (serviceData) { 
    state.service = serviceData.name; state.price = serviceData.price; state.duration = serviceData.duration; 
    // Si viene con servicio (desde tarjetas inicio), ir al Paso 2
    goToStep(2);
  } else {
    // Si viene boton general, ir al Paso 1
    goToStep(1);
  }
  updateSummary();
  modal.classList.add('open'); document.body.style.overflow = 'hidden';
}
function closeModal() { modal.classList.remove('open'); document.body.style.overflow = ''; }

closeBtn.addEventListener('click', closeModal);
backdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.getElementById('nav-book-btn').addEventListener('click', () => openModal(null));
document.getElementById('hero-book-btn').addEventListener('click', () => openModal(null));
document.getElementById('success-close').addEventListener('click', closeModal);

document.querySelectorAll('.service-book-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const c = btn.closest('.service-card');
    openModal({ name: c.dataset.name, price: c.dataset.price, duration: c.dataset.duration });
  });
});

document.querySelectorAll('.barber-item').forEach((item, i) => {
  item.addEventListener('click', () => { state.barber = BARBERS[i]; openModal(null); goToStep(3); });
  item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); } });
});

/* ──────────────────────────────────────────────────────────────
   SERVICE PICKER (STEP 1)
   ────────────────────────────────────────────────────────────── */
document.querySelectorAll('.modal-service-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.modal-service-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.service = card.dataset.srvName;
    state.price = card.dataset.srvPrice;
    state.duration = card.dataset.srvDuration;
    updateSummary();
  });
});

/* ──────────────────────────────────────────────────────────────
   BARBER PICKER
   ────────────────────────────────────────────────────────────── */
document.querySelectorAll('#barber-picker .barber-pick-card').forEach((card, i) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('#barber-picker .barber-pick-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.barber = BARBERS[i]; updateSummary();
  });
});

/* ──────────────────────────────────────────────────────────────
   STEP NAVIGATION
   ────────────────────────────────────────────────────────────── */
const stepContents = document.querySelectorAll('.step-content');
const stepDots = ['dot-1', 'dot-2', 'dot-3', 'dot-4'].map(id => document.getElementById(id));

function goToStep(n) {
  stepContents.forEach((sc, i) => sc.classList.toggle('active', i + 1 === n));
  document.getElementById('success-screen').classList.remove('visible');
  document.querySelector('.steps-indicator').style.visibility = 'visible';
  stepDots.forEach((dot, i) => {
    if (!dot) return;
    dot.classList.remove('active', 'done');
    const el = dot.querySelector('.step-num');
    if (i + 1 === n) { dot.classList.add('active'); el.textContent = i + 1; }
    else if (i + 1 < n) { dot.classList.add('done'); el.innerHTML = '<i class="fa-solid fa-check" style="font-size:0.6rem;"></i>'; }
    else { el.textContent = i + 1; }
  });
  if (n === 3) buildDayPicker(); // Ahora el día/hora es el paso 3
}

// Nav events for Step 1 -> 4
document.getElementById('s1-next').addEventListener('click', () => {
  if (!state.service) { showToast('Por favor selecciona un servicio.'); return; } goToStep(2);
});

// Paso 2 ahora es Profesionales
document.getElementById('s2-back').addEventListener('click', () => goToStep(1));
document.getElementById('s2-next').addEventListener('click', () => {
  if (!state.barber) { showToast('Por favor selecciona un barbero.'); return; } 
  goToStep(3);
});

// Paso 3 ahora es Fecha & Hora
document.getElementById('s3-back').addEventListener('click', () => goToStep(2));
document.getElementById('s3-next').addEventListener('click', async () => {
  if (!state.time) { showToast('Por favor selecciona un horario disponible.'); return; }
  goToStep(4);
});

document.getElementById('s4-back').addEventListener('click', () => goToStep(3));

/* ──────────────────────────────────────────────────────────────
   RUT VALIDATION & FORMATTING
   ────────────────────────────────────────────────────────────── */
function validateRUT(rut) {
  if (typeof rut !== 'string') return false;
  let clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return false;
  let dv = clean.slice(-1);
  let rutNum = clean.slice(0, -1);
  let sum = 0;
  let mul = 2;
  for (let i = rutNum.length - 1; i >= 0; i--) {
    sum += parseInt(rutNum[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  let res = 11 - (sum % 11);
  let expectedDv = res === 11 ? '0' : res === 10 ? 'K' : res.toString();
  return dv === expectedDv;
}

function formatRUT(rut) {
  let clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return clean;
  let dv = clean.slice(-1);
  let rutNum = clean.slice(0, -1);
  return rutNum.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
}

document.getElementById('f-rut')?.addEventListener('input', function(e) {
  this.value = this.value.replace(/[^0-9kK\.\-]/g, '').toUpperCase();
});

/* ──────────────────────────────────────────────────────────────
   CONFIRM BOOKING
   ────────────────────────────────────────────────────────────── */
document.getElementById('s4-confirm').addEventListener('click', async () => {
  const name = document.getElementById('f-name').value.trim();
  const rut = document.getElementById('f-rut').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const notes = document.getElementById('f-notes').value.trim();
  const terms = document.getElementById('f-terms').checked;

  if (!name) { showToast('Por favor ingresa tu nombre.'); return; }
  if (!rut) { showToast('Por favor ingresa tu RUT.'); return; }
  if (!validateRUT(rut)) { showToast('El RUT ingresado no es válido.'); return; }
  if (!phone) { showToast('Por favor ingresa tu teléfono.'); return; }
  if (!terms) { showToast('Debes aceptar los términos para continuar.'); return; }
  
  const cleanRut = formatRUT(rut);

  const payment = document.querySelector('input[name="f-payment"]:checked').value;
  const paymentText = payment === 'webpay' ? 'Webpay Plus (Online)' : 'Pago en el local';
  const finalNotes = notes ? `${notes} | Pago: ${paymentText}` : `Pago: ${paymentText}`;

  const booking = {
    id: Date.now(), name, rut: cleanRut, phone, email, notes: finalNotes,
    service: state.service || '(Sin especificar)',
    price: state.price || '—',
    duration: state.duration || '—',
    date: state.date || '—',
    time: state.time || '—',
    barber: state.barber || '—',
    createdAt: new Date().toISOString(),
    payment_method: paymentText
  };

  const confirmBtn = document.getElementById('s4-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Procesando...';

  // Si eligió Webpay Plus, abrimos el flujo online
  if (payment === 'webpay') {
    if (!SUPABASE_ON) { showToast('Webpay Plus requiere conexión a Supabase real.'); confirmBtn.disabled = false; return; }
    
    try {
      const numericPrice = parseInt((state.price || '0').replace(/[^0-9]/g, ''), 10);
      
      // Llamamos a la transaccion Deno (Edge Function de Transbank)
      const { data, error } = await sb.functions.invoke('create-webpay-tx', {
        body: {
          title: state.service,
          price: numericPrice,
          payer_name: name,
          booking: booking, // Depositamos la info de la cita para crearla post-pago
          frontendUrl: window.location.origin + window.location.pathname // <--- AGREGAR ESTO
        }
      });
      
      if (error || !data?.token || !data?.url) throw new Error(error?.message || 'Error al conectar con Transbank');

      // Creamos un Formulario transparente e inyectamos el Token de TBK para catapultar al usuario de forma segura
      const form = document.createElement('form');
      form.action = data.url;
      form.method = 'POST';
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'token_ws';
      input.value = data.token;
      
      form.appendChild(input);
      document.body.appendChild(form);
      
      confirmBtn.textContent = 'Redirigiendo a Banco...';
      form.submit();
      return; 
    } catch (err) {
      console.error('Error TBK:', err);
      showToast('Hubo un error al iniciar Webpay Plus. Intenta Pagar en el Local.');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirmar reserva';
      return;
    }
  }

  // Si eligió pago Local: Proceso tradicional
  const result = await persistBooking(booking);
  
  if (!result.ok && result.collision) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirmar reserva';
    alert("Lo sentimos, esa hora acaba de ser tomada por otro cliente hace unos instantes. Por favor, vuelve al paso 1 y elige una hora distinta.");
    return;
  }

  const bookingId = result.bookingId;
  await upsertClient(booking, bookingId);

  // 2) Mostrar pantalla de éxito
  stepContents.forEach(sc => sc.classList.remove('active'));
  document.querySelector('.steps-indicator').style.visibility = 'hidden';
  document.getElementById('success-screen').classList.add('visible');

  document.getElementById('success-msg').innerHTML =
    `Tu hora está reservada. En breve recibirás todos los detalles por <strong>WhatsApp</strong> al número que ingresaste.`;

  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Confirmar reserva';
});

// Listener de retorno de Pasarelas (Webpay Plus Redirecciona de Vuelta)
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  
  if (params.get('payment') === 'success') {
    // Al volver pago Pagado existosamente a través de las funciones Deno
    openModal(null);
    goToStep(4);
    stepContents.forEach(sc => sc.classList.remove('active'));
    document.querySelector('.steps-indicator').style.visibility = 'hidden';
    document.getElementById('success-screen').classList.add('visible');
    document.getElementById('success-msg').innerHTML =
      `¡Pago Exitoso por Webpay Plus! Tu reserva online ya está registrada y en sistema. ¡Gracias por confiar en nosotros!`;
    window.history.replaceState({}, document.title, window.location.pathname);
    
  } else if (params.get('payment') === 'failed' || params.get('payment') === 'rejected') {
     alert('Tu pago en Webpay rebotó o fue cancelado. La reserva no se procesó. Puedes reintentar o pagar en el local.');
     window.history.replaceState({}, document.title, window.location.pathname);
  }
});

/* ──────────────────────────────────────────────────────────────
   TOAST
   ────────────────────────────────────────────────────────────── */
function showToast(msg) {
  let t = document.getElementById('nb-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'nb-toast';
    Object.assign(t.style, {
      position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%) translateY(20px)',
      background: 'var(--white)', color: 'var(--black)', padding: '14px 28px', borderRadius: '4px',
      fontFamily: 'var(--font-sans)', fontSize: '0.83rem', fontWeight: '500',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: '9999', opacity: '0',
      transition: 'opacity 0.25s ease, transform 0.25s ease', whiteSpace: 'nowrap',
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(20px)'; }, 3500);
}

/* ──────────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────────── */
updateSummary();
