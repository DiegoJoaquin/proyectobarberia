// ============================================================
//  Spartan Barber — send-booking-whatsapp
//  Supabase Edge Function (Deno)
//  Triggered by a Database Webhook on INSERT to "bookings"
//  Sends a WhatsApp confirmation via Twilio
// ============================================================

Deno.serve(async (req: Request) => {
  // Solo aceptar POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.json();

    // El webhook de Supabase manda: { type: "INSERT", record: { ...booking } }
    const booking = payload?.record;

    if (!booking) {
      return new Response('No booking data', { status: 400 });
    }

    // Formatear el número: +56933278938 → whatsapp:+56933278938
    const rawPhone = (booking.phone || '').replace(/\s/g, '').replace(/^0/, '');
    const toPhone = rawPhone.startsWith('+')
      ? `whatsapp:${rawPhone}`
      : `whatsapp:+56${rawPhone}`;

    // Leer variables de entorno (configuradas como secrets en Supabase)
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
    const TWILIO_FROM = Deno.env.get('TWILIO_FROM_NUMBER') ?? 'whatsapp:+14155238886';

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.error('Missing Twilio credentials');
      return new Response('Missing credentials', { status: 500 });
    }

    // Armar el mensaje de confirmación
    const message =
      `✅ *¡Reserva Confirmada!* — Spartan Barber Co.

Hola, *${booking.name}*. Tu hora está agendada:

📋 *Servicio:* ${booking.service || '—'}
📅 *Fecha:* ${booking.date || '—'}
⏰ *Hora:* ${booking.time || '—'}
✂️ *Barbero:* ${booking.barber || 'A confirmar'}
💰 *Precio:* ${booking.price || '—'}

📍 Av. P. Alberto Hurtado 03, Local 22, Machalí

Si necesitas cambiar o cancelar tu hora, contáctanos:
📞 +56 9 8267 9620

¡Te esperamos! ⚔️`;

    // Llamar a la API de Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    const body = new URLSearchParams({
      To: toPhone,
      From: TWILIO_FROM,
      Body: message,
    });

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Twilio error:', result);
      return new Response(JSON.stringify({ error: result }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`WhatsApp enviado a ${toPhone} | SID: ${result.sid}`);
    return new Response(JSON.stringify({ success: true, sid: result.sid }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
