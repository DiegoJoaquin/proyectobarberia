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

          // Guardar a cliente en el directorio global (Upsert)
          try {
            const pts = booking.points_earned || 0;
            const { data: ext } = await supabaseClient.from('clients').select('id, points, total_visits').eq('rut', booking.rut).maybeSingle();
            if (ext) {
              await supabaseClient.from('clients').update({
                points: (ext.points || 0) + pts,
                total_visits: (ext.total_visits || 0) + 1,
                last_barber: booking.barber,
                updated_at: new Date().toISOString()
              }).eq('id', ext.id);
            } else {
              await supabaseClient.from('clients').insert({
                name: booking.name,
                phone: booking.phone,
                email: booking.email || null,
                rut: booking.rut || '',
                points: pts,
                total_visits: 1,
                last_barber: booking.barber,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
            }
          } catch (cErr: any) {
            console.error("Error al guardar cliente global:", cErr);
          }

          // NOTA: El envío automático de WhatsApp fue desactivado por costo.
          // El cliente ahora envía el mensaje de confirmación manualmente desde la página de éxito.
        }
        return Response.redirect(`https://www.spartanbarber.cl/?payment=success&token_ws=${token}`, 303)
      }
    }

    // C. ESCENARIO RECHAZO BANCARIO
    if (booking) await supabaseClient.from('bookings').delete().eq('id', booking.id)
    return Response.redirect(`https://www.spartanbarber.cl/?payment=rejected&token_ws=${token}`, 303)

  } catch (error: any) {
    console.error("Error Catch:", error.message)
    return Response.redirect(`https://www.spartanbarber.cl/?payment=error`, 303)
  }
})

