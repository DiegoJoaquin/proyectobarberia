// ============================================================
//  Spartan Barber — send-booking-whatsapp
//  Supabase Edge Function (Deno)
//  Triggered by a Database Webhook on INSERT/UPDATE to "bookings"
//  Sends a WhatsApp confirmation via Twilio (Content API)
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // Manejar Pre-Flight Request para invocar desde frontend
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    
    // Obtener información del registro
    let booking = payload?.record;
    const oldBooking = payload?.old_record;
    
    // Si la llamada viene directa del admin.html (`sb.functions.invoke`), saca los datos directo
    if (!booking && payload) booking = payload;

    if (!booking) return new Response('No booking data', { status: 400, headers: corsHeaders });

    // --- LÓGICA DE SEGURIDAD PARA WEBAPP ---
    
    // 1. Si la reserva dice 'waiting_payment', ignorarla.
    if (booking.status === 'waiting_payment') {
      console.log(`Reserva ${booking.id} en espera de pago. Ignorando.`);
      return new Response('Waiting for payment confirmation', { status: 200, headers: corsHeaders });
    }

    // 2. Si es una actualización vía Webhook (UPDATE), previene doble envío
    if (payload.type === 'UPDATE') {
      if (oldBooking?.status === 'confirmed') {
        return new Response('WhatsApp already sent previously', { status: 200, headers: corsHeaders });
      }
      if (booking.status !== 'confirmed') {
        return new Response('Status not confirmed yet', { status: 200, headers: corsHeaders });
      }
    }

    // --- CONFIGURACIÓN DE TWILIO ---
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
    const TWILIO_FROM = Deno.env.get('TWILIO_FROM_NUMBER') ?? '';

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
      console.error('Missing Twilio credentials');
      return new Response('Missing credentials', { status: 500, headers: corsHeaders });
    }

    // Formatear el número destino
    const rawPhone = (booking.phone || '').replace(/\s/g, '').replace(/^0/, '');
    const toPhone = rawPhone.startsWith('+') ? `whatsapp:${rawPhone}` : `whatsapp:+56${rawPhone}`;

    // --- TWILIO CONTENT API (Template) ---
    const CONTENT_SID = 'HX8c4c8a841ed6345ccc60814977cbb058';
    const contentVariables = {
      "1": String(booking.name || 'Cliente'),
      "2": String(booking.service || '—'),
      "3": String(booking.date || '—'),
      "4": String(booking.time || '—'),
      "5": String(booking.barber || '—'),
      "6": String(booking.price || '—')
    };

    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const body = new URLSearchParams({
      To: toPhone,
      From: TWILIO_FROM,
      ContentSid: CONTENT_SID,
      ContentVariables: JSON.stringify(contentVariables),
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(`Twilio Error: ${JSON.stringify(result)}`);

    console.log(`WhatsApp enviado con éxito a ${toPhone}`);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Error en robot WhatsApp:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
