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

    // --- FILTRO DE SEGURIDAD PARA WEBAPP ---
    // Si la reserva dice 'waiting_payment', significa que el cliente aún está en Webpay.
    // El robot debe ignorarla. Se enviará luego cuando el status cambie a 'confirmed'.
    if (booking.status === 'waiting_payment') {
      console.log(`Reserva ${booking.id} en espera de pago. No enviar WhatsApp aún.`);
      return new Response('Waiting for payment confirmation', { status: 200 });
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

    // --- TWILIO CONTENT API (Método oficial 2024 para Templates) ---
    // Usamos el ID del Template en lugar de escribir el texto a mano
    const CONTENT_SID = 'HX8c4c8a841ed6345ccc60814977cbb058';

    // Rellenamos las variables {{1}}, {{2}}, etc. del template
    const contentVariables = {
      "1": String(booking.name || 'Cliente'),
      "2": String(booking.service || '—'),
      "3": String(booking.date || '—'),
      "4": String(booking.time || '—'),
      "5": String(booking.barber || '—'),
      "6": String(booking.price || '—')
    };

    // Llamar a la API de Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    const body = new URLSearchParams({
      To: toPhone,
      From: TWILIO_FROM,
      ContentSid: CONTENT_SID,
      ContentVariables: JSON.stringify(contentVariables),
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
