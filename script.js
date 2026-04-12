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

/* 10% Cashback Points Logic */
function getPointsForService(priceString) {
  const numericPrice = parseInt((priceString || '0').replace(/[^0-9]/g, ''), 10);
  return Math.floor(numericPrice * 0.1); // 10% del valor
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
      date: booking.date_iso || booking.date, // Usar ISO si existe
      time: booking.time,
      barber: booking.barber,
      points_earned: booking.points_earned || 0,
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
    let existing = null;

    // 1. Buscar por teléfono (más confiable)
    if (booking.phone) {
      const { data } = await sb.from('clients').select('id, name, email, rut, phone, points, total_visits').eq('phone', booking.phone).maybeSingle();
      existing = data;
    }

    // 2. Si no encontró por teléfono, buscar por RUT
    if (!existing && booking.rut) {
      const normRut = booking.rut.replace(/[.\-\s]/g, '').toUpperCase();
      const { data: allClients } = await sb.from('clients').select('id, name, email, rut, phone, points, total_visits');
      existing = (allClients || []).find(c =>
        c.rut && c.rut.replace(/[.\-\s]/g, '').toUpperCase() === normRut
      ) || null;
    }

    let clientId;
    if (existing) {
      clientId = existing.id;
      // Actualizar datos si mejoran (nunca borrar datos existentes)
      await sb.from('clients').update({
        name: booking.name || existing.name,
        email: booking.email || existing.email,
        rut: booking.rut || existing.rut || null,
        phone: booking.phone || existing.phone || null,
        updated_at: new Date().toISOString(),
      }).eq('id', clientId);
    } else {
      // Cliente nuevo
      const { data: newClient } = await sb.from('clients').insert({
        name: booking.name,
        phone: booking.phone || null,
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
 * Returns array of booked slots { time, duration } for a given date label AND barber
 */
async function getBookedTimesForBarber(dateStr, barberName) {
  if (SUPABASE_ON) {
    const datesToSearch = state.dateIso ? [dateStr, state.dateIso] : [dateStr];
    const { data, error } = await sb
      .from('bookings')
      .select('time, duration, status, created_at')
      .in('date', datesToSearch)
      .eq('barber', barberName)
      .in('status', ['confirmed', 'waiting_payment', 'Confirmado', 'Llegó', 'Atendido', 'Reserva Normal', 'Pendiente']);
    if (error) { console.warn('Supabase select error:', error); }
    
    // Filtrar waiting_payment con > 10 minutos (bloqueo caducado por abandono de Webpay)
    const now = new Date().getTime();
    const validData = (data || []).filter(r => {
      if (r.status === 'waiting_payment') {
        const created = new Date(r.created_at).getTime();
        const diffMinutes = (now - created) / 60000;
        if (diffMinutes > 10) return false; // Libera la hora
      }
      return true;
    });

    return validData.map(r => ({ time: r.time, duration: r.duration }));
  }
  return lsGetAll().filter(b => b.date === dateStr && b.barber === barberName).map(b => ({ time: b.time, duration: b.duration }));
}

// Suscripción Real-Time para que los slots se liberen/ocupen al instante
if (SUPABASE_ON) {
  sb.channel('bookings-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
      if (state.date && state.barber) refreshTimePills();
    })
    .subscribe();
}

/**
 * Returns barber blocks for a given JS Date object.
 * Each block: { barber_name, block_type, start_time?, end_time? }
 */
async function getBarberBlocksForDate(dateObjOrIso) {
  if (!SUPABASE_ON) return [];
  let iso;
  if (typeof dateObjOrIso === 'string') {
    iso = dateObjOrIso;
  } else if (dateObjOrIso instanceof Date) {
    const y = dateObjOrIso.getFullYear();
    const mo = String(dateObjOrIso.getMonth() + 1).padStart(2, '0');
    const d = String(dateObjOrIso.getDate()).padStart(2, '0');
    iso = `${y}-${mo}-${d}`;
  } else {
    return [];
  }
  try {
    // Fetch directo con anon key para garantizar acceso público a barber_blocks
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/barber_blocks?select=barber_name,block_type,start_time,end_time&block_date=eq.${iso}`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) { console.warn('[Blocks] HTTP error:', res.status); return []; }
    const data = await res.json();
    console.log(`[Blocks] ${iso}: ${(data||[]).length} bloqueos →`, data);
    return data || [];
  } catch(e) {
    console.warn('[Blocks] error:', e);
    return [];
  }
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
  'Matías N.',           // index 0 — debe coincidir con barber_name en barber_blocks
  'Ángel',              // index 1
  'Benjamín',           // index 2
  'Gonzalo',            // index 3
  'Matias Muñoz Quevedo' // index 4
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
function parseHM(str) { const [h, m] = (str||'').split(':').map(Number); return (h||0) * 60 + (m||0); }
function toHM(mins) { const h = Math.floor(mins/60); const m = mins%60; return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`; }

function parseDurationMins(dStr) {
  if (!dStr) return 30;
  const s = dStr.toLowerCase();
  if (s.includes('1 hr 15')) return 75;
  if (s.includes('1 hr 30')) return 90;
  if (s.includes('1 hr') || s.includes('1h')) return 60;
  const match = s.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);
  return 30; // fallback
}

async function refreshTimePills() {
  const isWeekend = state.dateObj && state.dateObj.getDay() === 6;
  const isSunday = state.dateObj && state.dateObj.getDay() === 0;

  // Clear existing grids
  const gridManana = document.querySelector('.time-section:nth-of-type(2) .time-grid');
  const gridTarde = document.querySelector('.time-section:nth-of-type(3) .time-grid');
  const gridNoche = document.querySelector('.time-section:nth-of-type(4) .time-grid');
  if(gridManana) gridManana.innerHTML = '';
  if(gridTarde) gridTarde.innerHTML = '';
  if(gridNoche) gridNoche.innerHTML = '';

  if (!state.date || !state.barber || !state.duration || isSunday) return;

  const now = new Date();
  const isToday = state.dateObj.getFullYear() === now.getFullYear() &&
                  state.dateObj.getMonth() === now.getMonth() &&
                  state.dateObj.getDate() === now.getDate();
  const nowMin = now.getHours() * 60 + now.getMinutes(); // no buffer — slot disabled only after it starts

  // Usar state.dateIso si está disponible (evita timezone issues)
  const blocksInput = state.dateIso || state.dateObj;
  const blocks = await getBarberBlocksForDate(blocksInput);
  
  // Normalizar nombre del barbero para comparación robusta
  const normBarber = (state.barber || '').trim().toLowerCase();
  const fullDayBlock = blocks.find(b =>
    b.barber_name && b.barber_name.trim().toLowerCase() === normBarber &&
    b.block_type === 'full_day'
  );
  if (fullDayBlock) {
    // Mostrar mensaje de día completo bloqueado en lugar de slots vacíos
    [gridManana, gridTarde, gridNoche].forEach(g => {
      if (g) g.innerHTML = '<p style="color:#e74c3c;font-size:0.85rem;padding:8px 0;">🚫 Barbero no disponible este día</p>';
    });
    return;
  }

  const hourBlocks = blocks.filter(b =>
    b.barber_name && b.barber_name.trim().toLowerCase() === normBarber &&
    b.block_type === 'hours'
  );
  console.log(`[Blocks] Barbero: ${state.barber}, bloques de hora:`, hourBlocks);
  
  // Data fetching completada
  const bookedSlots = await getBookedTimesForBarber(state.date, state.barber);
  
  // Build busy intervals
  let busyIntervals = [];
  bookedSlots.forEach(b => {
      const st = parseHM(b.time);
      const dur = parseDurationMins(b.duration);
      busyIntervals.push({ start: st, end: st + dur });
  });
  hourBlocks.forEach(b => {
      if(b.start_time && b.end_time) busyIntervals.push({ start: parseHM(b.start_time), end: parseHM(b.end_time) });
  });

  // Add Lunch break to busy intervals
  if (isWeekend) {
      busyIntervals.push({ start: parseHM('13:45'), end: parseHM('14:30') });
  } else {
      busyIntervals.push({ start: parseHM('14:00'), end: parseHM('14:45') });
  }

  // Generate Fixed Interval Slots dynamically based on service duration
  const serviceMins = parseDurationMins(state.duration);
  let fixedSlots;
  
  if (serviceMins > 60) {
      if (isWeekend) {
          fixedSlots = ['10:00', '10:45', '11:15', '12:15', '12:30', '14:30', '15:15', '15:45', '16:45', '17:00'];
      } else {
          fixedSlots = ['11:00', '11:30', '12:15', '12:30', '12:45', '15:00', '15:30', '16:15', '17:00', '17:30', '18:30', '18:45'];
      }
  } else if (serviceMins > 45) {
      if (isWeekend) {
          fixedSlots = ['10:00', '11:00', '12:00', '14:30', '15:30', '16:30', '17:15'];
      } else {
          fixedSlots = ['11:00', '12:00', '13:00', '15:00', '16:00', '17:00', '18:00', '19:00'];
      }
  } else {
      if (isWeekend) {
          fixedSlots = ['10:00', '10:45', '11:30', '12:15', '13:00', '14:30', '15:15', '16:00', '16:45', '17:30'];
      } else {
          fixedSlots = ['11:00', '11:45', '12:30', '13:15', '14:45', '15:30', '16:15', '17:00', '17:45', '18:30', '19:15'];
      }
  }
  
  const candidateSlots = fixedSlots.map(s => parseHM(s));

  // Filter overlapping
  const slots = [];
  candidateSlots.forEach(slotStart => {
      const slotEnd = slotStart + Math.max(serviceMins, 15); // Minimun block checking
      const overlap = busyIntervals.some(b => slotStart < b.end && slotEnd > b.start);
      if (!overlap) slots.push(slotStart);
  });

  // Render slots 
  slots.forEach(tMin => {
      const timeStr = toHM(tMin);
      const isPast = isToday && tMin <= nowMin;
      const btn = document.createElement('button');
      btn.className = 'time-pill' + (isPast ? ' busy past' : '');
      btn.dataset.time = timeStr;
      btn.textContent = timeStr;
      if (isPast) {
          btn.disabled = true;
          btn.setAttribute('aria-label', `${timeStr} — No disponible`);
      } else {
          btn.disabled = false;
          btn.setAttribute('aria-label', timeStr);
          btn.onclick = () => {
              document.querySelectorAll('.time-pill').forEach(p => p.classList.remove('selected'));
              btn.classList.add('selected');
              state.time = timeStr;
              updateSummary();
          };
      }

      // Append to correct section
      if (tMin < parseHM('14:00') && gridManana) gridManana.appendChild(btn);
      else if (tMin >= parseHM('14:00') && tMin < parseHM('18:00') && gridTarde) gridTarde.appendChild(btn);
      else if (gridNoche) gridNoche.appendChild(btn);
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

    // Usar componentes locales para evitar shift de timezone (Chile = UTC-4)
    const isoDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

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
        state.dateIso = isoDate;
        updateSummary();
        refreshTimePills();
      });
    }

    if (i === 0) { state.date = lbl; state.dateObj = d; state.dateIso = isoDate; }
    picker.appendChild(pill);
  }
  refreshTimePills();
  updateSummary();
}

/* ──────────────────────────────────────────────────────────────
   TIME PILLS — delegated click now inside refreshTimePills
   ────────────────────────────────────────────────────────────── */


/* ──────────────────────────────────────────────────────────────
   MODAL OPEN / CLOSE
   ────────────────────────────────────────────────────────────── */
const modal = document.getElementById('booking-modal');
const backdrop = document.getElementById('modal-backdrop');
const closeBtn = document.getElementById('modal-close-btn');

function openModal(serviceData) {
  // Resetear readonly del autocompletado RUT
  ['f-name', 'f-email'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.readOnly = false; el.style.opacity = '1'; el.value = ''; }
  });
  // Resetear campo de dígitos del teléfono
  const phoneDigits = document.getElementById('f-phone-digits');
  if (phoneDigits) { phoneDigits.readOnly = false; phoneDigits.style.opacity = '1'; phoneDigits.value = ''; }
  const phoneHidden = document.getElementById('f-phone');
  if (phoneHidden) phoneHidden.value = '';
  const rutEl = document.getElementById('f-rut');
  if (rutEl) rutEl.value = '';
  const statusEl = document.getElementById('rut-lookup-status');
  if (statusEl) statusEl.textContent = '';
  const phoneErr = document.getElementById('phone-error');
  if (phoneErr) phoneErr.style.display = 'none';
  
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

document.querySelectorAll('.barber-item').forEach((item) => {
  // Usar data-barber como índice explícito (no el índice del forEach que puede desplazarse)
  const barberIdx = parseInt(item.dataset.barber, 10);
  const barberName = BARBERS[barberIdx];
  item.addEventListener('click', () => {
    if (barberName) state.barber = barberName;
    // Si ya hay servicio elegido ir directo al paso 3, sino al paso 1
    if (state.service && state.duration) {
      openModal(null);
      goToStep(3);
      setTimeout(() => { if (state.date && state.barber && state.duration) refreshTimePills(); }, 100);
    } else {
      openModal(null); // va a paso 1 para elegir servicio
    }
  });
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
document.querySelectorAll('#barber-picker .barber-pick-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('#barber-picker .barber-pick-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    const barberIdx = parseInt(card.dataset.barber || card.dataset.barberIdx || 0, 10);
    const barberName = BARBERS[barberIdx];
    if (barberName) state.barber = barberName;
    updateSummary();
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
  // Refrescar slots con el barbero recén seleccionado
  if (state.date && state.duration) refreshTimePills();
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

// RUT input — formato auto y lookup en Supabase
document.getElementById('f-rut')?.addEventListener('input', function(e) {
  this.value = this.value.replace(/[^0-9kK\.\-]/g, '').toUpperCase();
});

// Teléfono: solo dígitos, formato automático XXXX XXXX al escribir
document.getElementById('f-phone-digits')?.addEventListener('input', function() {
  // Solo números
  let digits = this.value.replace(/\D/g, '').slice(0, 8);
  // Insertar espacio visual en posición 4: "9876 5432"
  if (digits.length > 4) {
    digits = digits.slice(0, 4) + ' ' + digits.slice(4);
  }
  this.value = digits;
});

document.getElementById('f-rut')?.addEventListener('blur', async function() {
  const rut = this.value.trim();
  const statusEl = document.getElementById('rut-lookup-status');
  if (!rut || !SUPABASE_ON) {
    if (statusEl) statusEl.textContent = '';
    return;
  }

  const isValid = validateRUT(rut);
  if (!isValid) {
    if (statusEl) { statusEl.textContent = '\u26a0\ufe0f RUT inv\u00e1lido'; statusEl.style.color = '#eb0029'; }
    return;
  }

  const formattedRut  = formatRUT(rut);          // "13.097.529-1"
  const rutSinPuntos  = formattedRut.replace(/\./g, '');        // "13097529-1"
  const rutSinTodo    = formattedRut.replace(/[.\-]/g, '');     // "130975291"
  // Patrón ilike correcto: busca dentro del valor almacenado con puntos, ignorando el dígito verif.
  const rutBodyConPuntos = formattedRut.replace(/-[0-9kK]$/, ''); // "13.097.529"

  this.value = formattedRut;
  if (statusEl) { statusEl.textContent = 'Buscando...'; statusEl.style.color = 'var(--grey-40)'; }

  try {
    // Usar .in() — maneja caracteres especiales (puntos, guiones) correctamente
    const { data: rows, error } = await sb
      .from('clients')
      .select('id, name, phone, email, rut')
      .in('rut', [formattedRut, rutSinPuntos, rutSinTodo])
      .limit(1);

    let data = rows?.[0] || null;

    // Fallback: buscar por el número base entrelazado para ignorar mágicamente cualquier formato (puntos, espacios)
    if (!data && !error) {
      const wild = '%' + rutSinTodo.slice(0, -1).split('').join('%') + '%';
      const { data: rows2 } = await sb
        .from('clients')
        .select('id, name, phone, email, rut')
        .ilike('rut', wild)
        .limit(1);
      data = rows2?.[0] || null;
    }

    // Log para diagnóstico — ver en F12 > Console
    console.log('[RUT v3] formatos buscados:', [formattedRut, rutSinPuntos, rutSinTodo]);
    console.log('[RUT v3] error:', error);
    console.log('[RUT v3] resultado:', data);

    if (data) {
      const nameEl   = document.getElementById('f-name');
      const emailEl  = document.getElementById('f-email');
      const digitsEl = document.getElementById('f-phone-digits');
      const hiddenEl = document.getElementById('f-phone');

      if (nameEl)  { nameEl.value  = data.name  || ''; nameEl.readOnly  = true; nameEl.style.opacity  = '0.7'; }
      if (emailEl && data.email) { emailEl.value = data.email; emailEl.readOnly = true; emailEl.style.opacity = '0.7'; }

      // Extraer los dígitos después del +569 para mostrar solo el número local
      if (digitsEl && data.phone) {
        const stripped = data.phone.replace(/\s/g, '').replace(/^\+?569?/, ''); // quita +56 9 del inicio
        digitsEl.value = stripped;
        digitsEl.readOnly = true;
        digitsEl.style.opacity = '0.7';
        if (hiddenEl) hiddenEl.value = '+569' + stripped;
      }

      if (statusEl) { statusEl.textContent = '\u2705 Cliente encontrado \u2014 datos autocargados'; statusEl.style.color = '#32cd32'; }
    } else {
      ['f-name', 'f-phone', 'f-email'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.readOnly = false; el.style.opacity = '1'; }
      });
      if (error) {
        console.error('[RUT v3] ERROR completo:', JSON.stringify(error));
        if (statusEl) { statusEl.textContent = '\u26a0\ufe0f Error: ' + (error.message || error.code); statusEl.style.color = '#eb0029'; }
      } else {
        if (statusEl) { statusEl.textContent = 'Cliente nuevo, ingresa tus datos.'; statusEl.style.color = 'var(--gold)'; }
      }
    }
  } catch(err) {
    console.error('[RUT v3] excepci\u00f3n:', err);
    if (statusEl) { statusEl.textContent = 'Error al conectar. Ingresa tus datos.'; statusEl.style.color = '#eb0029'; }
  }
});

/* ──────────────────────────────────────────────────────────────
   CONFIRM BOOKING
   ────────────────────────────────────────────────────────────── */
document.getElementById('s4-confirm').addEventListener('click', async () => {
  const name  = document.getElementById('f-name').value.trim();
  const rut   = document.getElementById('f-rut').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const notes = document.getElementById('f-notes').value.trim();
  const terms = document.getElementById('f-terms').checked;

  if (!rut)               { showToast('Por favor ingresa tu RUT.'); return; }
  if (!validateRUT(rut))  { showToast('El RUT ingresado no es válido.'); return; }
  if (!name)              { showToast('Por favor ingresa tu nombre.'); return; }

  // Construir el teléfono completo desde el prefijo fijo +569 + dígitos
  const phoneDigitsEl = document.getElementById('f-phone-digits');
  const rawDigits     = (phoneDigitsEl?.value || '').replace(/\s/g, '');
  const phone         = '+569' + rawDigits;
  const phoneRegex    = /^\+569\d{8}$/;

  if (!rawDigits || rawDigits.length !== 8 || !phoneRegex.test(phone)) {
    const errEl = document.getElementById('phone-error');
    if (errEl) errEl.style.display = 'block';
    showToast('Ingresa los 8 dígitos de tu teléfono (ej: 9876 5432)');
    phoneDigitsEl?.focus();
    return;
  }
  const errElPhone = document.getElementById('phone-error');
  if (errElPhone) errElPhone.style.display = 'none';
  // Guardar teléfono completo en el campo oculto (por si algo lo lee después)
  const phoneHiddenEl = document.getElementById('f-phone');
  if (phoneHiddenEl) phoneHiddenEl.value = phone;

  if (!terms) { showToast('Debes aceptar los términos para continuar.'); return; }
  
  const cleanRut = formatRUT(rut);

  const paymentText = 'Webpay Plus (Online)';
  const finalNotes = notes ? `${notes} | Pago: ${paymentText}` : `Pago: ${paymentText}`;

  const booking = {
    id: Date.now(), name, rut: cleanRut, phone, email, notes: finalNotes,
    service: state.service || '(Sin especificar)',
    price: state.price || '—',
    duration: state.duration || '—',
    date: state.dateIso || state.date || '—',
    time: state.time || '—',
    barber: state.barber || '—',
    created_at: new Date().toISOString(),
    payment_method: paymentText,
    status: 'waiting_payment',
    points_earned: getPointsForService(state.price)
  };

  const confirmBtn = document.getElementById('s4-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Procesando...';

  if (!SUPABASE_ON) { showToast('El pago online requiere conexión a Supabase.'); confirmBtn.disabled = false; return; }
  
  try {
    const numericPrice = parseInt((state.price || '0').replace(/[^0-9]/g, ''), 10);
    
    // Guardamos el estado para no perder el resumen al volver
    localStorage.setItem('booking_state', JSON.stringify(state));
    
    const { data, error } = await sb.functions.invoke('create-webpay-tx', {
      body: {
        title: state.service,
        price: numericPrice,
        payer_name: name,
        booking: booking,
        frontendUrl: window.location.origin + window.location.pathname
      }
    });
    
    if (error || !data?.token || !data?.url) throw new Error(error?.message || 'Error al conectar con Transbank');

    // Formulario oculto para redirigir al banco de forma segura (POST)
    const form = document.createElement('form');
    form.action = data.url;
    form.method = 'POST';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'token_ws';
    input.value = data.token;
    form.appendChild(input);
    document.body.appendChild(form);
    
    confirmBtn.textContent = 'Redirigiendo al Banco...';
    form.submit();
    return;
  } catch (err) {
    console.error('Error TBK:', err);
    showToast('Error al iniciar Webpay. Escríbenos al WhatsApp para agendar.');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirmar reserva';
    return;
  }
});

// Listener de retorno de Pasarelas (Webpay Plus Redirecciona de Vuelta)
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  
  if (params.get('payment') === 'success') {
    // Al volver pago Pagado existosamente a través de las funciones Deno
    openModal(null);
    goToStep(4);
    stepContents.forEach(sc => sc.classList.remove('active'));
    // RECUPERAR ESTADO PARA EL RESUMEN
    const savedState = localStorage.getItem('booking_state');
    if (savedState) {
      Object.assign(state, JSON.parse(savedState));
      updateSummary();
      localStorage.removeItem('booking_state');
    }

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

/* ──────────────────────────────────────────────────────────────
   WEBPAY RETURN — Detectar resultado del pago al cargar la página
   ────────────────────────────────────────────────────────────── */
(function checkPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get('payment');
  const tokenWs = params.get('token_ws');

  if (paymentStatus === 'success') {
    // NO borramos la URL: el token_ws debe quedar visible para certificación Transbank

    // Recuperar datos guardados
    const savedState = localStorage.getItem('booking_state');
    if (savedState) {
      try {
        const bkState = JSON.parse(savedState);
        localStorage.removeItem('booking_state');
        
        // Buscar el booking recién insertado por la Edge Function para obtener su ID
        if (SUPABASE_ON && bkState.phone) {
          setTimeout(async () => {
            try {
              const { data: recentBooking } = await sb
                .from('bookings')
                .select('id')
                .eq('phone', bkState.phone)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              
              const bookingObj = {
                name: bkState.name || '',
                phone: bkState.phone || '',
                rut: bkState.rut || '',
                email: bkState.email || ''
              };
              await upsertClient(bookingObj, recentBooking?.id || null);
              console.log('[upsertClient] Cliente registrado/actualizado tras pago exitoso.');
            } catch (e) { console.warn('[upsertClient] Error en registro post-pago:', e); }
          }, 1500);
        }
      } catch(e) { console.warn('Error parsing booking_state:', e); }
    }

    // Toast de confirmación
    setTimeout(() => {
      showToast('✅ ¡Pago confirmado! Tu hora ha sido agendada. Recibirás confirmación por WhatsApp.');
    }, 500);

    // Token visible en consola también
    if (tokenWs) {
      console.log('%c✅ Pago Webpay confirmado', 'color:green;font-weight:bold');
      console.log('%ctoken_ws para certificación:', 'color:orange', tokenWs);
    }

  } else if (paymentStatus === 'rejected') {
    // NO borramos la URL para permitir ver el token_ws en certificaciones
    setTimeout(() => {
      showToast('❌ El pago fue rechazado o cancelado. Por favor intenta nuevamente.');
    }, 500);

    if (tokenWs) {
      console.log('%c❌ Pago Webpay rechazado', 'color:red;font-weight:bold');
      console.log('%ctoken_ws para certificación:', 'color:orange', tokenWs);
    }
  } else if (paymentStatus === 'timeout') {
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(() => {
      showToast('⏳ La sesión de pago ha expirado por inactividad. Por favor, intenta agendar nuevamente.');
    }, 500);
  } else if (paymentStatus === 'error') {
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(() => {
      showToast('⚠️ Ocurrió un error al procesar el pago. Contáctanos si el problema persiste.');
    }, 500);
  }
})();

