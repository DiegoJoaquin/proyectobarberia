import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const bodyText = await req.text()
    const searchParams = new URLSearchParams(bodyText)
    
    // 1. Obtener Token
    const token = url.searchParams.get('token_ws') || searchParams.get('token_ws') || searchParams.get('TBK_TOKEN')
    
    if (!token) return new Response("Token Missing", { status: 400 })

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Buscar la Reserva
    const { data: bookings } = await supabaseClient
      .from('bookings')
      .select('*')
      .filter('notes', 'ilike', `%[TBK_TOKEN:${token}]%`)
      .limit(1)

    const booking = bookings?.[0]
    
    let fUrl = 'https://spartan-barber.com' 
    if (booking?.notes) {
      const match = booking.notes.match(/\[FRONT_URL:(.*?)\]/)
      if (match && match[1] && match[1] !== 'undefined') fUrl = match[1]
    }

    // 3. Confirmar con Transbank (Commit)
    const TBK_COMMERCE_CODE = Deno.env.get('TBK_COMMERCE_CODE') || "597055555532"
    const TBK_API_KEY = Deno.env.get('TBK_API_KEY') || "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C"
    const TBK_ENVIRONMENT = Deno.env.get('TBK_ENVIRONMENT') || "INTEGRATION"
    const tbkBaseUrl = TBK_ENVIRONMENT === "PRODUCTION" ? 'https://webpay3g.transbank.cl' : 'https://webpay3gint.transbank.cl'

    const txResponse = await fetch(`${tbkBaseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions/${token}`, {
      method: 'PUT',
      headers: { 'Tbk-Api-Key-Id': TBK_COMMERCE_CODE, 'Tbk-Api-Key-Secret': TBK_API_KEY, 'Content-Type': 'application/json' }
    })

    const txData = await txResponse.json()

    // 4. Resultado de la Transacción
    if (txResponse.ok && txData.status === 'AUTHORIZED') {
      if (booking) {
         // ACTUALIZAMOS ESTADO A 'confirmed'. 
         // PRESERVAMOS el TBK_TOKEN para futuras anulaciones (refunds)
         const newNotes = booking.notes
           .replace(/\[FRONT_URL:(.*?)\]/, '') // Quitamos el FRONT_URL
           + ` [TBK_AUTH:${txData.authorization_code}]`; // Añadimos la auth y dejamos el TBK_TOKEN intacto
         
         await supabaseClient.from('bookings').update({ 
           status: 'confirmed', 
           notes: newNotes.trim() 
         }).eq('id', booking.id)

         // ============================================
         // NUEVO: Enviar WhatsApp DIRECTO por Twilio
         // ============================================
         try {
            console.log("Iniciando envío de WhatsApp para reserva:", booking.id);
            const rawPhone = (booking.phone || '').replace(/\s/g, '').replace(/^0/, '');
            const toPhone = rawPhone.startsWith('+') ? `whatsapp:${rawPhone}` : `whatsapp:+56${rawPhone}`;

            const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
            const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
            const TWILIO_FROM = Deno.env.get('TWILIO_FROM_NUMBER') ?? 'whatsapp:+14155238886';
            
            if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
              const CONTENT_SID = 'HX8c4c8a841ed6345ccc60814977cbb058';
              const contentVariables = {
                "1": String(booking.name || 'Cliente'),
                "2": String(booking.service || '—'),
                "3": String(booking.date || '—'),
                "4": String(booking.time || '—'),
                "5": String(booking.barber || '—'),
                "6": String(booking.price || '—')
              };

              const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
              const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
              
              const body = new URLSearchParams({
                To: toPhone,
                From: TWILIO_FROM,
                ContentSid: CONTENT_SID,
                ContentVariables: JSON.stringify(contentVariables),
              });

              const twilioRes = await fetch(twilioUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${auth}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: body.toString(),
              });
              
              const twilioData = await twilioRes.json();
              if (!twilioRes.ok) {
                console.error("Error Twilio:", twilioData);
              } else {
                console.log(`WhatsApp enviado | SID: ${twilioData.sid}`);
              }
            } else {
              console.error("Credenciales Twilio faltantes en webpay-return");
            }
         } catch(e) {
           console.error("Error al enviar WhatsApp directo:", e.message);
         }
      }
      return Response.redirect(`${fUrl}?payment=success`, 302)
    } else {
      // Si falló el pago, borramos la reserva temporal
      if (booking) await supabaseClient.from('bookings').delete().eq('id', booking.id)
      return Response.redirect(`${fUrl}?payment=rejected`, 302)
    }
  } catch (error) {
    console.error("Error en Webpay Return:", error.message)
    return new Response(`Error: ${error.message}`, { status: 500 })
  }
})
