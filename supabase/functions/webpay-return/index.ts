import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

serve(async (req) => {
  // Transbank devuelve al cliente usando POST (application/x-www-form-urlencoded)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const bodyText = await req.text()
    const searchParams = new URLSearchParams(bodyText)
    
    const token_ws = searchParams.get('token_ws')
    const tbk_token = searchParams.get('TBK_TOKEN') // Se recibe si el usuario anuló la compra
    
    const token = token_ws || tbk_token
    
    if (!token) {
      return new Response("Transbank Token Missing", { status: 400 })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Encontrar la Reserva en Borrador atada a este Token
    const { data: bookings, error } = await supabaseClient
      .from('bookings')
      .select('*')
      .filter('notes', 'ilike', `%[TBK_TOKEN:${token}]%`)
      .limit(1)

    const booking = bookings?.[0]

    // 2. Rescatar la URL del Front
    let fUrl = 'https://spartan-barber.com'
    if (booking && booking.notes) {
      const match = booking.notes.match(/\[FRONT_URL:(.*?)\]/)
      if (match && match[1]) fUrl = match[1]
    }

    // 3. Cliente anuló el pago de regreso al comercio prematuramente
    if (tbk_token) {
      if (booking) await supabaseClient.from('bookings').delete().eq('id', booking.id)
      return Response.redirect(`${fUrl}?payment=failed`, 302)
    }

    // 4. Confirmar con Transbank (Certificación Reversa)
    const TBK_COMMERCE_CODE = Deno.env.get('TBK_COMMERCE_CODE') || "597055555532"
    const TBK_API_KEY = Deno.env.get('TBK_API_KEY') || "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C"
    const TBK_ENVIRONMENT = Deno.env.get('TBK_ENVIRONMENT') || "INTEGRATION" // 'INTEGRATION' o 'PRODUCTION'
    
    // Entorno Inteligente: Prueba VS Producción
    const tbkBaseUrl = TBK_ENVIRONMENT === "PRODUCTION"
      ? 'https://webpay3g.transbank.cl'
      : 'https://webpay3gint.transbank.cl'

    const txResponse = await fetch(`${tbkBaseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions/${token}`, {
      method: 'PUT',
      headers: {
        'Tbk-Api-Key-Id': TBK_COMMERCE_CODE,
        'Tbk-Api-Key-Secret': TBK_API_KEY,
        'Content-Type': 'application/json'
      }
    })

    const txData = await txResponse.json()
    // Retorna { status: 'AUTHORIZED', response_code: 0, authorization_code: '...', ... }

    // 5. Aplicar Inteligencia a la Base de Datos
    if (txResponse.ok && txData.status === 'AUTHORIZED' && txData.response_code === 0) {
      // PAGO EXITOSO: Actualizamos la base de datos confirmando la cita y limpiando las notas.
      if (booking) {
         const newNotes = booking.notes
            .replace(`[TBK_TOKEN:${token}]`, `[TBK_AUTH:${txData.authorization_code}]`)
            .replace(/\[FRONT_URL:(.*?)\]/, '')

         await supabaseClient.from('bookings').update({
            attended: true,
            notes: newNotes.trim()
         }).eq('id', booking.id)

         // Llamar silenciosamente a la function de WP para mandar el SMS
         await supabaseClient.functions.invoke('send-booking-whatsapp', {
            body: { record: { ...booking, payment_method: 'Webpay Plus' } }
         })
      }
      return Response.redirect(`${fUrl}?payment=success`, 302)
    } else {
      // PAGO RECHAZADO: Fondos insuficientes, tarjeta bloqueada, etc.
      if (booking) await supabaseClient.from('bookings').delete().eq('id', booking.id)
      return Response.redirect(`${fUrl}?payment=rejected`, 302)
    }

  } catch (error) {
    console.error("Transbank Return Error:", error)
    return new Response("Internal Gateway Error", { status: 500 })
  }
})
