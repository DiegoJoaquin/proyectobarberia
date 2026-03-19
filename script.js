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
        updated_at: new Date().toISOString(),
      }).eq('id', clientId);
    } else {
      const { data: newClient } = await sb.from('clients').insert({
        name: booking.name,
        phone: booking.phone,
        email: booking.email || null,
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
 * Returns array of booked time strings for a given date label
 * e.g. ['10:00', '14:30'] for "Mar 10 mar"
 * Async because Supabase is async; refreshTimePills awaits it.
 */
async function getBookedTimesForDate(dateStr) {
  if (SUPABASE_ON) {
    const { data, error } = await sb
      .from('bookings')
      .select('time')
      .eq('date', dateStr);
    if (error) { console.warn('Supabase select error:', error); }
    return (data || []).map(r => r.time);
  }
  return lsGetAll().filter(b => b.date === dateStr).map(b => b.time);
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

/**
 * Given the blocks for today, hides/disables blocked barber cards
 * and blocks specific time pills for barbers blocked by hours.
 */
function applyBarberBlocks(blocks) {
  // --- 1. Barber cards (step 2 picker) ---
  document.querySelectorAll('.barber-pick-card').forEach((card, i) => {
    const barberName = BARBERS[i];
    card.querySelector('.block-badge')?.remove();
    card.style.opacity = '';
    card.style.pointerEvents = '';
    card.title = '';

    const fullDayBlock = blocks.find(b => b.barber_name === barberName && b.block_type === 'full_day');
    const hourBlock    = blocks.find(b => b.barber_name === barberName && b.block_type === 'hours');

    if (fullDayBlock) {
      card.style.opacity = '0.3';
      card.style.pointerEvents = 'none';
      card.title = 'No disponible este día';
      const badge = document.createElement('span');
      badge.className = 'block-badge';
      badge.textContent = 'No disponible';
      badge.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);color:#f87171;font-size:.7rem;font-weight:700;letter-spacing:.05em;border-radius:inherit;cursor:not-allowed;';
      card.style.position = 'relative';
      card.appendChild(badge);
    } else if (hourBlock) {
      card.title = `Disponible fuera de ${hourBlock.start_time}–${hourBlock.end_time}`;
      const badge = document.createElement('span');
      badge.className = 'block-badge';
      badge.textContent = `⏱ ${hourBlock.start_time}–${hourBlock.end_time} bloqueado`;
      badge.style.cssText = 'position:absolute;bottom:6px;left:0;right:0;text-align:center;background:rgba(127,29,29,.75);color:#fca5a5;font-size:.6rem;font-weight:700;letter-spacing:.04em;padding:3px 6px;cursor:default;';
      card.style.position = 'relative';
      card.appendChild(badge);
    }
  });
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

  // Fetch booked times (Supabase or LS)
  const bookedTimes = state.date ? await getBookedTimesForDate(state.date) : [];
  const nowMin = now.getHours() * 60 + now.getMinutes() + 45; // 45-min buffer

  pills.forEach(pill => {
    const t = pill.dataset.time;
    if (!t) return;

    pill.classList.remove('past', 'booked', 'selected');

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
        // Aplicar bloqueos de barberos para este día
        const blocks = await getBarberBlocksForDate(d);
        applyBarberBlocks(blocks);
      });
    }

    if (i === 0) { state.date = lbl; state.dateObj = d; }
    picker.appendChild(pill);
  }
  refreshTimePills();
  updateSummary();
  // Aplicar bloqueos para el día inicial
  getBarberBlocksForDate(state.dateObj).then(blocks => applyBarberBlocks(blocks));
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
  if (n === 2) buildDayPicker();
}

// Nav events for Step 1 -> 4
document.getElementById('s1-next').addEventListener('click', () => {
  if (!state.service) { showToast('Por favor selecciona un servicio.'); return; } goToStep(2);
});

document.getElementById('s2-back').addEventListener('click', () => goToStep(1));
document.getElementById('s2-next').addEventListener('click', () => {
  if (!state.time) { showToast('Por favor selecciona un horario disponible.'); return; } goToStep(3);
});

document.getElementById('s3-back').addEventListener('click', () => goToStep(2));
document.getElementById('s3-next').addEventListener('click', async () => {
  if (!state.barber) { showToast('Por favor selecciona un barbero.'); return; }

  // Validar bloqueo por horas del barbero seleccionado
  if (state.dateObj && state.time && SUPABASE_ON) {
    const blocks = await getBarberBlocksForDate(state.dateObj);
    const hourBlock = blocks.find(b =>
      b.barber_name === state.barber &&
      b.block_type === 'hours' &&
      b.start_time && b.end_time
    );
    if (hourBlock) {
      function hm(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
      const chosenMin = hm(state.time);
      if (chosenMin >= hm(hourBlock.start_time) && chosenMin < hm(hourBlock.end_time)) {
        showToast(`${state.barber} no está disponible de ${hourBlock.start_time} a ${hourBlock.end_time}. Por favor elige otro horario o barbero.`);
        return;
      }
    }
  }

  goToStep(4);
});

document.getElementById('s4-back').addEventListener('click', () => goToStep(3));

/* ──────────────────────────────────────────────────────────────
   CONFIRM BOOKING
   ────────────────────────────────────────────────────────────── */
document.getElementById('s4-confirm').addEventListener('click', async () => {
  const name = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const notes = document.getElementById('f-notes').value.trim();
  const terms = document.getElementById('f-terms').checked;

  if (!name) { showToast('Por favor ingresa tu nombre.'); return; }
  if (!phone) { showToast('Por favor ingresa tu teléfono.'); return; }
  if (!terms) { showToast('Debes aceptar los términos para continuar.'); return; }

  const payment = document.querySelector('input[name="f-payment"]:checked').value;
  const paymentText = payment === 'transferencia' ? 'Transferencia (Pago anticipado)' : 'Pago en el local';
  const finalNotes = notes ? `${notes} | Pago: ${paymentText}` : `Pago: ${paymentText}`;

  const booking = {
    id: Date.now(), name, phone, email, notes: finalNotes,
    service: state.service || '(Sin especificar)',
    price: state.price || '—',
    duration: state.duration || '—',
    date: state.date || '—',
    time: state.time || '—',
    barber: state.barber || '—',
    createdAt: new Date().toISOString(),
  };

  const confirmBtn = document.getElementById('s3-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Guardando...';

  // 1) Save to Supabase (or localStorage fallback) + upsert client profile
  const result = await persistBooking(booking);
  
  if (!result.ok && result.collision) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirmar reserva';
    alert("Lo sentimos, esa hora acaba de ser tomada por otro cliente hace unos instantes. Por favor, vuelve al paso 1 y elige una hora distinta.");
    return; // Frenar ejecución
  }

  const bookingId = result.bookingId;
  await upsertClient(booking, bookingId);

  // 2) Mostrar pantalla de éxito (el WhatsApp llega automáticamente via Supabase + Twilio)
  stepContents.forEach(sc => sc.classList.remove('active'));
  document.querySelector('.steps-indicator').style.visibility = 'hidden';
  document.getElementById('success-screen').classList.add('visible');

  document.getElementById('success-msg').innerHTML =
    `Tu hora está reservada. En breve recibirás todos los detalles por <strong>WhatsApp</strong> al número que ingresaste.`;

  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Confirmar reserva';
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
