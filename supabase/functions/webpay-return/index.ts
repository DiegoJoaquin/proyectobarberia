import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const bodyText = await req.text()
    const params = new URLSearchParams(bodyText)
    
    // 1. CAPTURA DE PARÁMETROS (Transbank entrega distintos según el flujo)
    const tokenSuccess = params.get('token_ws') || url.searchParams.get('token_ws')
    const tokenAbort = params.get('TBK_TOKEN') || url.searchParams.get('TBK_TOKEN')
    const token = tokenSuccess || tokenAbort
    
    // CASO TIMEOUT (Recomendación Transbank Producción)
    // Cuando el usuario demora >5 min, no llega token pero sí TBK_ID_SESION
    const tbkSession = params.get('TBK_ID_SESION') || url.searchParams.get('TBK_ID_SESION')
    const tbkBuyOrder = params.get('TBK_ORDEN_COMPRA') || url.searchParams.get('TBK_ORDEN_COMPRA')

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // A. ESCENARIO TIMEOUT / SESIÓN EXPIRADA
    if (!token && tbkSession) {
      console.log(`Timeout detectado para sesión: ${tbkSession}`);
      // Liberar el cupo borrando la reserva temporal (usamos el ID que enviamos como session_id)
      await supabaseClient.from('bookings').delete().eq('id', tbkSession)
      return Response.redirect(`https://www.spartanbarber.cl/?payment=timeout`, 303)
    }

    if (!token) {
      return Response.redirect(`https://www.spartanbarber.cl/?payment=error&reason=no_token`, 303)
    }

    // 2. BUSCAR LA RESERVA (Por token guardado en notas)
    const { data: bookings } = await supabaseClient
      .from('bookings')
      .select('*')
      .filter('notes', 'ilike', `%[TBK_TOKEN:${token}]%`)
      .limit(1)

    const booking = bookings?.[0]
    
    // B. ESCENARIO ANULACIÓN MANUAL (TBK_TOKEN presente pero no token_ws)
    if (tokenAbort && !tokenSuccess) {
      if (booking) await supabaseClient.from('bookings').delete().eq('id', booking.id)
      return Response.redirect(`https://www.spartanbarber.cl/?payment=rejected&token_ws=${token}`, 303)
    }

    // 3. CONFIRMAR CON TRANSBANK (COMMIT)
    const TBK_COMMERCE_CODE = Deno.env.get('TBK_COMMERCE_CODE') || "597055555532"
    const TBK_API_KEY = Deno.env.get('TBK_API_KEY') || "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C"
    const TBK_ENVIRONMENT = Deno.env.get('TBK_ENVIRONMENT') || "INTEGRATION"
    const tbkBaseUrl = TBK_ENVIRONMENT === "PRODUCTION" ? 'https://webpay3g.transbank.cl' : 'https://webpay3gint.transbank.cl'

    const txResponse = await fetch(`${tbkBaseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions/${token}`, {
      method: 'PUT',
      headers: { 
        'Tbk-Api-Key-Id': TBK_COMMERCE_CODE, 
        'Tbk-Api-Key-Secret': TBK_API_KEY, 
        'Content-Type': 'application/json' 
      }
    })

    if (txResponse.ok) {
      const txData = await txResponse.json()
      
      if (txData.status === 'AUTHORIZED') {
        if (booking) {
          // Confirmar reserva en DB
          const newNotes = (booking.notes || '').replace(/\[FRONT_URL:(.*?)\]/, '') + ` [TBK_AUTH:${txData.authorization_code}]`
          await supabaseClient.from('bookings').update({ status: 'confirmed', notes: newNotes.trim() }).eq('id', booking.id)

          // --- ENVÍO DE WHATSAPP (TWILIO) ---
          try {
            const rawPhone = (booking.phone || '').replace(/\s/g, '').replace(/^0/, '')
            const toPhone = rawPhone.startsWith('+') ? `whatsapp:${rawPhone}` : `whatsapp:+56${rawPhone}`
            const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
            const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
            const TWILIO_FROM = Deno.env.get('TWILIO_FROM_NUMBER') || 'whatsapp:+14155238886'

            if (TWILIO_SID && TWILIO_TOKEN) {
              const vars = { "1": String(booking.name || 'Cliente'), "2": String(booking.service || '—'), "3": String(booking.date || '—'), "4": String(booking.time || '—'), "5": String(booking.barber || '—'), "6": String(booking.price || '—') }
              const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)
              await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
                method: 'POST',
                headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ To: toPhone, From: TWILIO_FROM, ContentSid: 'HX8c4c8a841ed6345ccc60814977cbb058', ContentVariables: JSON.stringify(vars) })
              })
            }
          } catch(e) { console.error("Error WhatsApp:", e.message) }
        }
        return Response.redirect(`https://www.spartanbarber.cl/?payment=success&token_ws=${token}`, 303)
      }
    }

    // C. ESCENARIO RECHAZO BANCARIO
    if (booking) await supabaseClient.from('bookings').delete().eq('id', booking.id)
    return Response.redirect(`https://www.spartanbarber.cl/?payment=rejected&token_ws=${token}`, 303)

  } catch (error) {
    console.error("Error Catch:", error.message)
    return Response.redirect(`https://www.spartanbarber.cl/?payment=error`, 303)
  }
})

