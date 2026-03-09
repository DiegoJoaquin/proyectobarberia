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
  publicKey:  'HvIa6Fo7CaG8Assxu',
  serviceId:  'service_c1pe70s',
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

/** Insert booking. Returns { ok, error } */
async function persistBooking(booking) {
  if (SUPABASE_ON) {
    const { error } = await sb.from('bookings').insert([{
      name:     booking.name,
      phone:    booking.phone,
      email:    booking.email,
      notes:    booking.notes,
      service:  booking.service,
      price:    booking.price,
      duration: booking.duration,
      date:     booking.date,
      time:     booking.time,
      barber:   booking.barber,
    }]);
    if (error) { console.warn('Supabase insert error, falling back to LS:', error); lsSave(booking); return { ok: false, error }; }
    return { ok: true };
  }
  lsSave(booking);
  return { ok: true };
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
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
    document.querySelectorAll('.service-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active'); btn.setAttribute('aria-selected','true');
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

const BARBERS = ['Marco Reyes', 'Camilo Torres', 'Sebastián Mora', 'Ricardo Infante'];
const DAYS    = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MONTHS  = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

function updateSummary() {
  document.getElementById('sum-service').textContent = state.service || '—';
  document.getElementById('sum-price').textContent   = state.price   || '—';
  const ph = t => `<span class="summary-placeholder">${t}</span>`;
  document.getElementById('sum-date').innerHTML     = state.date     ? state.date     : ph('Sin seleccionar');
  document.getElementById('sum-time').innerHTML     = state.time     ? state.time     : ph('Sin seleccionar');
  document.getElementById('sum-duration').innerHTML = state.duration ? state.duration : ph('—');
  document.getElementById('sum-barber').innerHTML   = state.barber   ? state.barber   : ph('Sin seleccionar');
}

/* ──────────────────────────────────────────────────────────────
   TIME FILTERING
   ────────────────────────────────────────────────────────────── */
function parseHM(str) { const [h,m] = str.split(':').map(Number); return h*60+m; }

async function refreshTimePills() {
  const pills   = document.querySelectorAll('.time-pill');
  const now     = new Date();
  const isToday = state.dateObj &&
    state.dateObj.getFullYear() === now.getFullYear() &&
    state.dateObj.getMonth()    === now.getMonth()    &&
    state.dateObj.getDate()     === now.getDate();

  // Fetch booked times (Supabase or LS)
  const bookedTimes = state.date ? await getBookedTimesForDate(state.date) : [];
  const nowMin = now.getHours()*60 + now.getMinutes() + 30; // 30-min buffer

  pills.forEach(pill => {
    const t = pill.dataset.time;
    if (!t) return;

    pill.classList.remove('past','booked','selected');

    // 1. Already booked
    if (bookedTimes.includes(t)) {
      pill.classList.add('busy'); pill.disabled = true;
      pill.setAttribute('aria-label', `${t} — Reservado`);
      return;
    }
    // 2. Past time today
    if (isToday && parseHM(t) <= nowMin) {
      pill.classList.add('busy','past'); pill.disabled = true;
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
    const d   = new Date(today);
    d.setDate(today.getDate() + i);
    const sun = d.getDay() === 0;
    const lbl = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

    const pill = document.createElement('button');
    pill.className = 'day-pill' + (i===0?' selected':'') + (sun?' disabled':'');
    pill.disabled  = sun;
    pill.setAttribute('role','listitem');
    pill.setAttribute('aria-label', lbl + (sun?' — Cerrado':''));
    pill.innerHTML = `<span>${DAYS[d.getDay()]}</span>
      <span class="day-num">${d.getDate()}</span>
      <span style="font-size:0.62rem;color:var(--grey-60)">${MONTHS[d.getMonth()]}</span>`;

    if (!sun) {
      pill.addEventListener('click', () => {
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
const modal    = document.getElementById('booking-modal');
const backdrop = document.getElementById('modal-backdrop');
const closeBtn = document.getElementById('modal-close-btn');

function openModal(serviceData) {
  if (serviceData) { state.service = serviceData.name; state.price = serviceData.price; state.duration = serviceData.duration; }
  updateSummary(); goToStep(1);
  modal.classList.add('open'); document.body.style.overflow = 'hidden';
}
function closeModal() { modal.classList.remove('open'); document.body.style.overflow = ''; }

closeBtn.addEventListener('click', closeModal);
backdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.getElementById('nav-book-btn').addEventListener('click',  () => openModal(null));
document.getElementById('hero-book-btn').addEventListener('click', () => openModal(null));
document.getElementById('success-close').addEventListener('click', closeModal);

document.querySelectorAll('.service-book-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const c = btn.closest('.service-card');
    openModal({ name: c.dataset.name, price: c.dataset.price, duration: c.dataset.duration });
  });
});

document.querySelectorAll('.barber-item').forEach((item, i) => {
  item.addEventListener('click', () => { state.barber = BARBERS[i]; openModal(null); goToStep(2); });
  item.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); item.click(); } });
});

/* ──────────────────────────────────────────────────────────────
   BARBER PICKER
   ────────────────────────────────────────────────────────────── */
document.querySelectorAll('.barber-pick-card').forEach((card, i) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.barber-pick-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.barber = BARBERS[i]; updateSummary();
  });
});

/* ──────────────────────────────────────────────────────────────
   STEP NAVIGATION
   ────────────────────────────────────────────────────────────── */
const stepContents = document.querySelectorAll('.step-content');
const stepDots     = ['dot-1','dot-2','dot-3'].map(id => document.getElementById(id));

function goToStep(n) {
  stepContents.forEach((sc,i) => sc.classList.toggle('active', i+1===n));
  document.getElementById('success-screen').classList.remove('visible');
  document.querySelector('.steps-indicator').style.visibility = 'visible';
  stepDots.forEach((dot,i) => {
    dot.classList.remove('active','done');
    const el = dot.querySelector('.step-num');
    if (i+1===n)    { dot.classList.add('active'); el.textContent = i+1; }
    else if (i+1<n) { dot.classList.add('done'); el.innerHTML = '<i class="fa-solid fa-check" style="font-size:0.6rem;"></i>'; }
    else             { el.textContent = i+1; }
  });
  if (n===1) buildDayPicker();
}

document.getElementById('s1-next').addEventListener('click', () => {
  if (!state.time)   { showToast('Por favor selecciona un horario disponible.'); return; } goToStep(2);
});
document.getElementById('s2-back').addEventListener('click', () => goToStep(1));
document.getElementById('s2-next').addEventListener('click', () => {
  if (!state.barber) { showToast('Por favor selecciona un barbero.'); return; } goToStep(3);
});
document.getElementById('s3-back').addEventListener('click', () => goToStep(2));

/* ──────────────────────────────────────────────────────────────
   CONFIRM BOOKING
   ────────────────────────────────────────────────────────────── */
document.getElementById('s3-confirm').addEventListener('click', async () => {
  const name  = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const notes = document.getElementById('f-notes').value.trim();
  const terms = document.getElementById('f-terms').checked;

  if (!name)  { showToast('Por favor ingresa tu nombre.'); return; }
  if (!phone) { showToast('Por favor ingresa tu teléfono.'); return; }
  if (!terms) { showToast('Debes aceptar los términos para continuar.'); return; }

  const booking = {
    id: Date.now(), name, phone, email, notes,
    service:  state.service  || '(Sin especificar)',
    price:    state.price    || '—',
    duration: state.duration || '—',
    date:     state.date     || '—',
    time:     state.time     || '—',
    barber:   state.barber   || '—',
    createdAt: new Date().toISOString(),
  };

  const confirmBtn = document.getElementById('s3-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Guardando...';

  // 1) Save to Supabase (or localStorage fallback)
  await persistBooking(booking);

  // 2) Send email via EmailJS
  if (email) {
    try {
      await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
        to_email: email,
        to_name:  name,
        service:  booking.service,
        price:    booking.price,
        date:     booking.date,
        time:     booking.time,
        barber:   booking.barber,
        phone,
        notes:    notes || 'Ninguna',
      });
    } catch (err) {
      console.warn('EmailJS send error:', err);
    }
  }

  // 3) Show success
  stepContents.forEach(sc => sc.classList.remove('active'));
  document.querySelector('.steps-indicator').style.visibility = 'hidden';
  document.getElementById('success-screen').classList.add('visible');
  document.getElementById('success-msg').innerHTML =
    `Hola <strong>${name}</strong>, tu reserva de <strong>${booking.service}</strong>
     para el <strong>${booking.date}</strong> a las <strong>${booking.time}</strong>
     con <strong>${booking.barber}</strong> está confirmada.
     ${email ? `<br/>Enviamos un comprobante a <strong>${email}</strong>.` : ''}
     <br/>Te recordaremos por WhatsApp al <strong>${phone}</strong>.`;

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
      position:'fixed', bottom:'32px', left:'50%', transform:'translateX(-50%) translateY(20px)',
      background:'var(--white)', color:'var(--black)', padding:'14px 28px', borderRadius:'4px',
      fontFamily:'var(--font-sans)', fontSize:'0.83rem', fontWeight:'500',
      boxShadow:'0 8px 32px rgba(0,0,0,0.5)', zIndex:'9999', opacity:'0',
      transition:'opacity 0.25s ease, transform 0.25s ease', whiteSpace:'nowrap',
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; });
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(20px)'; }, 3500);
}

/* ──────────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────────── */
updateSummary();
