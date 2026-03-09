/* ============================================================
   NOIR & BLADE — script.js  (v2)
   ► Smart time filtering (past slots disabled in real time)
   ► localStorage booking persistence
   ► EmailJS email confirmation to client
   ============================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   ██  EMAILJS CONFIG
   ──────────────────────────────────────────────────────────────
   Para activar los correos de confirmación:
   1. Crea una cuenta gratuita en https://www.emailjs.com
   2. Crea un Email Service (Gmail, Outlook, etc.)
   3. Crea un Email Template con las variables de abajo
   4. Copia tu Public Key, Service ID y Template ID aquí.
   ────────────────────────────────────────────────────────────── */
const EMAILJS_CONFIG = {
  publicKey:  'TU_PUBLIC_KEY',    // ← Tu Public Key de EmailJS
  serviceId:  'TU_SERVICE_ID',   // ← El ID de tu servicio de correo
  templateId: 'TU_TEMPLATE_ID',  // ← El ID del template
  // Variables disponibles en tu template de EmailJS:
  // {{to_email}}   → correo del cliente
  // {{to_name}}    → nombre del cliente
  // {{service}}    → nombre del servicio
  // {{price}}      → precio del servicio
  // {{date}}       → fecha seleccionada
  // {{time}}       → hora seleccionada
  // {{barber}}     → nombre del barbero
  // {{phone}}      → teléfono del cliente
  // {{notes}}      → indicaciones opcionales
};

const EMAIL_ENABLED =
  EMAILJS_CONFIG.publicKey  !== 'TU_PUBLIC_KEY' &&
  EMAILJS_CONFIG.serviceId  !== 'TU_SERVICE_ID' &&
  EMAILJS_CONFIG.templateId !== 'TU_TEMPLATE_ID';

if (EMAIL_ENABLED) {
  emailjs.init(EMAILJS_CONFIG.publicKey);
}

/* ──────────────────────────────────────────────────────────────
   STORAGE HELPERS
   ────────────────────────────────────────────────────────────── */
const STORAGE_KEY = 'nb_bookings';

function getBookings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveBooking(booking) {
  const all = getBookings();
  all.push(booking);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Get booked times for a given display-date string (e.g. "Lun 9 mar") */
function getBookedTimesForDate(dateStr) {
  return getBookings()
    .filter(b => b.date === dateStr)
    .map(b => b.time);
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
const tabBtns = document.querySelectorAll('.tab-btn');
const panels  = document.querySelectorAll('.service-panel');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    tabBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    panels.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById('panel-' + target)?.classList.add('active');
  });
});

/* ──────────────────────────────────────────────────────────────
   STATE
   ────────────────────────────────────────────────────────────── */
const state = {
  service:  null,
  price:    null,
  duration: null,
  date:     null,      // display string, e.g. "Lun 9 mar"
  dateObj:  null,      // actual Date object
  time:     null,
  barber:   null,
};

const BARBERS = ['Marco Reyes', 'Camilo Torres', 'Sebastián Mora', 'Ricardo Infante'];

const DAYS   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function updateSummary() {
  document.getElementById('sum-service').textContent = state.service || '—';
  document.getElementById('sum-price').textContent   = state.price   || '—';

  const ph = txt => `<span class="summary-placeholder">${txt}</span>`;
  document.getElementById('sum-date').innerHTML     = state.date   ? state.date   : ph('Sin seleccionar');
  document.getElementById('sum-time').innerHTML     = state.time   ? state.time   : ph('Sin seleccionar');
  document.getElementById('sum-duration').innerHTML = state.duration? state.duration: ph('—');
  document.getElementById('sum-barber').innerHTML   = state.barber ? state.barber  : ph('Sin seleccionar');
}

/* ──────────────────────────────────────────────────────────────
   TIME FILTERING
   ────────────────────────────────────────────────────────────── */

/** Parse "HH:MM" into { h, m } */
function parseTime(str) {
  const [h, m] = str.split(':').map(Number);
  return { h, m };
}

/**
 * Given the currently selected date, refresh all time pills:
 *  - If date is today → disable slots that are in the past (+ 30 min buffer)
 *  - Mark slots already booked for that date
 */
function refreshTimePills() {
  const pills      = document.querySelectorAll('.time-pill');
  const now        = new Date();
  const isToday    = state.dateObj &&
    state.dateObj.getFullYear() === now.getFullYear() &&
    state.dateObj.getMonth()    === now.getMonth()    &&
    state.dateObj.getDate()     === now.getDate();

  const bookedTimes = state.date ? getBookedTimesForDate(state.date) : [];

  pills.forEach(pill => {
    const timeStr = pill.dataset.time;
    if (!timeStr) return;

    // Reset classes from dynamic state (keep original .busy if HTML-defined)
    pill.classList.remove('past', 'booked', 'selected');

    // 1) Booked by someone (localStorage)
    if (bookedTimes.includes(timeStr)) {
      pill.classList.add('busy');
      pill.setAttribute('aria-label', `${timeStr} — Reservado`);
      pill.disabled = true;
      return;
    }

    // 2) Past time on today's date
    if (isToday) {
      const { h, m } = parseTime(timeStr);
      const slotMinutes = h * 60 + m;
      // Current time + 30 min buffer
      const nowMinutes  = now.getHours() * 60 + now.getMinutes() + 30;
      if (slotMinutes <= nowMinutes) {
        pill.classList.add('busy', 'past');
        pill.setAttribute('aria-label', `${timeStr} — No disponible`);
        pill.disabled = true;
        return;
      }
    }

    // 3) Available
    pill.classList.remove('busy');
    pill.disabled = false;
    pill.setAttribute('aria-label', timeStr);
  });

  // Clear selected time if it became unavailable
  if (state.time) {
    const selectedPill = document.querySelector(`.time-pill[data-time="${state.time}"]`);
    if (!selectedPill || selectedPill.classList.contains('busy')) {
      state.time = null;
      updateSummary();
    } else {
      selectedPill.classList.add('selected');
    }
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

    const isSunday  = d.getDay() === 0;
    const dayLabel  = DAYS[d.getDay()];
    const dateNum   = d.getDate();
    const monLabel  = MONTHS[d.getMonth()];
    const displayStr = `${dayLabel} ${dateNum} ${monLabel}`;

    const pill = document.createElement('button');
    pill.className = 'day-pill' + (i === 0 ? ' selected' : '') + (isSunday ? ' disabled' : '');
    pill.disabled  = isSunday;
    pill.setAttribute('role', 'listitem');
    pill.setAttribute('aria-label', displayStr + (isSunday ? ' — Cerrado' : ''));
    pill.innerHTML = `
      <span>${dayLabel}</span>
      <span class="day-num">${dateNum}</span>
      <span style="font-size:0.62rem;color:var(--grey-60)">${monLabel}</span>`;

    if (!isSunday) {
      pill.addEventListener('click', () => {
        picker.querySelectorAll('.day-pill').forEach(p => p.classList.remove('selected'));
        pill.classList.add('selected');
        state.date    = displayStr;
        state.dateObj = d;
        updateSummary();
        refreshTimePills();
      });
    }

    if (i === 0) {
      state.date    = displayStr;
      state.dateObj = d;
    }

    picker.appendChild(pill);
  }

  refreshTimePills();
  updateSummary();
}

/* ──────────────────────────────────────────────────────────────
   TIME PILLS — click handler
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
  if (serviceData) {
    state.service  = serviceData.name;
    state.price    = serviceData.price;
    state.duration = serviceData.duration;
  }
  updateSummary();
  goToStep(1);
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

closeBtn.addEventListener('click', closeModal);
backdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ── Triggers ── */
document.getElementById('nav-book-btn').addEventListener('click', () => openModal(null));
document.getElementById('hero-book-btn').addEventListener('click', () => openModal(null));
document.getElementById('success-close').addEventListener('click', closeModal);

document.querySelectorAll('.service-book-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.service-card');
    openModal({
      name:     card.dataset.name,
      price:    card.dataset.price,
      duration: card.dataset.duration,
    });
  });
});

document.querySelectorAll('.barber-item').forEach((item, i) => {
  item.addEventListener('click', () => {
    state.barber = BARBERS[i];
    openModal(null);
    goToStep(2);
  });
  item.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }
  });
});

/* ──────────────────────────────────────────────────────────────
   BARBER PICKER (step 2)
   ────────────────────────────────────────────────────────────── */
document.querySelectorAll('.barber-pick-card').forEach((card, i) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.barber-pick-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.barber = BARBERS[i];
    updateSummary();
  });
});

/* ──────────────────────────────────────────────────────────────
   STEP NAVIGATION
   ────────────────────────────────────────────────────────────── */
const stepContents = document.querySelectorAll('.step-content');
const stepDots     = [
  document.getElementById('dot-1'),
  document.getElementById('dot-2'),
  document.getElementById('dot-3'),
];

function goToStep(n) {
  stepContents.forEach((sc, i) => sc.classList.toggle('active', i + 1 === n));
  document.getElementById('success-screen').classList.remove('visible');
  document.querySelector('.steps-indicator').style.visibility = 'visible';

  stepDots.forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    const numEl = dot.querySelector('.step-num');
    if (i + 1 === n) {
      dot.classList.add('active');
      numEl.textContent = i + 1;
    } else if (i + 1 < n) {
      dot.classList.add('done');
      numEl.innerHTML = '<i class="fa-solid fa-check" style="font-size:0.6rem;"></i>';
    } else {
      numEl.textContent = i + 1;
    }
  });

  if (n === 1) buildDayPicker();
}

document.getElementById('s1-next').addEventListener('click', () => {
  if (!state.time) { showToast('Por favor selecciona un horario disponible.'); return; }
  goToStep(2);
});
document.getElementById('s2-back').addEventListener('click', () => goToStep(1));
document.getElementById('s2-next').addEventListener('click', () => {
  if (!state.barber) { showToast('Por favor selecciona un barbero.'); return; }
  goToStep(3);
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

  // Build booking object
  const booking = {
    id:        Date.now(),
    name, phone, email, notes,
    service:  state.service  || '(Sin especificar)',
    price:    state.price    || '—',
    duration: state.duration || '—',
    date:     state.date     || '—',
    time:     state.time     || '—',
    barber:   state.barber   || '—',
    createdAt: new Date().toISOString(),
  };

  // 1) Disable the confirm button to avoid double clicks
  const confirmBtn = document.getElementById('s3-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Guardando...';

  // 2) Save to localStorage
  saveBooking(booking);

  // 3) Send email via EmailJS (if configured)
  if (EMAIL_ENABLED && email) {
    try {
      await emailjs.send(
        EMAILJS_CONFIG.serviceId,
        EMAILJS_CONFIG.templateId,
        {
          to_email: email,
          to_name:  name,
          service:  booking.service,
          price:    booking.price,
          date:     booking.date,
          time:     booking.time,
          barber:   booking.barber,
          phone,
          notes:    notes || 'Ninguna',
        }
      );
    } catch (err) {
      console.warn('EmailJS error (reserva guardada de todos modos):', err);
    }
  }

  // 4) Show success screen
  stepContents.forEach(sc => sc.classList.remove('active'));
  document.querySelector('.steps-indicator').style.visibility = 'hidden';
  const successScreen = document.getElementById('success-screen');
  successScreen.classList.add('visible');

  const emailNote = email
    ? (EMAIL_ENABLED
        ? `<br/>Enviamos una confirmación a <strong>${email}</strong>.`
        : `<br/><small style="color:var(--grey-50)">(Configura EmailJS para enviar correos automáticos)</small>`)
    : '';

  document.getElementById('success-msg').innerHTML =
    `Hola <strong>${name}</strong>, tu reserva de <strong>${booking.service}</strong>
    para el <strong>${booking.date}</strong> a las <strong>${booking.time}</strong>
    con <strong>${booking.barber}</strong> está confirmada.${emailNote}
    <br/>Te enviaremos un recordatorio por WhatsApp al <strong>${phone}</strong>.`;

  // Reset button
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Confirmar reserva';
});

/* ──────────────────────────────────────────────────────────────
   TOAST
   ────────────────────────────────────────────────────────────── */
function showToast(msg) {
  let t = document.getElementById('nb-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'nb-toast';
    Object.assign(t.style, {
      position: 'fixed', bottom: '32px', left: '50%',
      transform: 'translateX(-50%) translateY(20px)',
      background: 'var(--white)', color: 'var(--black)',
      padding: '14px 28px', borderRadius: '4px',
      fontFamily: 'var(--font-sans)', fontSize: '0.83rem', fontWeight: '500',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      zIndex: '9999', opacity: '0',
      transition: 'opacity 0.25s ease, transform 0.25s ease',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => {
    t.style.opacity   = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity   = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3500);
}

/* ──────────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────────── */
updateSummary();
