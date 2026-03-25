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

         // Llama manualmente a send-booking-whatsapp simulando el evento de webhook
         try {
           const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
           const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
           await fetch(`${projectUrl}/functions/v1/send-booking-whatsapp`, {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${anonKey}`
             },
             body: JSON.stringify({
               type: 'WEBHOOK_MOCK',
               record: { ...booking, status: 'confirmed' }
             })
           });
           console.log("WhatsApp push enviado post-pago.");
         } catch(e) {
           console.error("Error al enviar WhatsApp post-pago:", e.message);
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
