import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { title, price, payer_name, booking, frontendUrl } = await req.json()

    // 1. Obtener llaves (Configuración Dinámica)
    const TBK_COMMERCE_CODE = Deno.env.get('TBK_COMMERCE_CODE') || "597055555532"
    const TBK_API_KEY = Deno.env.get('TBK_API_KEY') || "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C"
    const TBK_ENVIRONMENT = Deno.env.get('TBK_ENVIRONMENT') || "INTEGRATION" // 'INTEGRATION' o 'PRODUCTION'
    
    // Entorno Inteligente: Prueba VS Producción
    const tbkBaseUrl = TBK_ENVIRONMENT === "PRODUCTION"
      ? 'https://webpay3g.transbank.cl'
      : 'https://webpay3gint.transbank.cl'
      
    const sessionId = Date.now().toString()
    const buyOrder = `SBC-${sessionId.slice(-10)}` // Número de pedido autogenerado
    
    // 2. URL de Retorno (Apuntando a la 2da Edge Function `webpay-return`)
    const returnUrl = `https://hgxayxrszmcmmrrwxlxz.supabase.co/functions/v1/webpay-return` 

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ── GUARDA ANTI-DOBLE-RESERVA (SERVIDOR) ──────────────────────────────────
    // Verificación server-side antes de crear la transacción en Transbank.
    // Esta es la barrera definitiva: si el frontend falló en detectar el conflicto,
    // esta verificación lo detiene antes de cobrarle al cliente.
    if (booking.barber && booking.date && booking.time) {
      const { count: existingCount, error: countError } = await supabaseClient
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('barber', booking.barber)
        .eq('date', booking.date)
        .eq('time', booking.time)
        .in('status', ['confirmed', 'waiting_payment', 'Confirmado', 'Llegó', 'Atendido', 'Reserva Normal', 'Pendiente'])

      if (!countError && existingCount && existingCount > 0) {
        console.warn(`[CONFLICT] Slot ocupado: ${booking.barber} | ${booking.date} ${booking.time}. Reservas activas: ${existingCount}`)
        return new Response(
          JSON.stringify({ conflict: true, message: 'Horario ya reservado por otro cliente.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
        )
      }
    }
    // ── FIN GUARDA ─────────────────────────────────────────────────────────────

    // 3. Crear Firma Inicial Transbank
    const txPayload = {
      buy_order: buyOrder,
      session_id: sessionId,
      amount: price,
      return_url: returnUrl
    }

    // Timeout de 35s contra Transbank: si TBK no responde, lanzar error claro
    // (El frontend tiene 40s de margen, así este timeout siempre dispara primero)
    const tbkAbortCtrl = new AbortController()
    const tbkTimeout = setTimeout(() => tbkAbortCtrl.abort(), 35000)
    let txResponse: Response
    try {
      txResponse = await fetch(`${tbkBaseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions`, {
        method: 'POST',
        headers: {
          'Tbk-Api-Key-Id': TBK_COMMERCE_CODE,
          'Tbk-Api-Key-Secret': TBK_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(txPayload),
        signal: tbkAbortCtrl.signal
      })
    } catch (fetchErr: any) {
      if (fetchErr.name === 'AbortError') {
        throw new Error('Transbank no respondió a tiempo. Por favor intenta en unos minutos.')
      }
      throw fetchErr
    } finally {
      clearTimeout(tbkTimeout)
    }

    if (!txResponse.ok) {
      const err = await txResponse.text()
      console.error("Transbank Auth Error:", err)
      throw new Error("Transbank Init Error: " + err)
    }

    const txData = await txResponse.json()
    // Transbank devuelve { token: "xxxx", url: "https://..." }
    
    // 4. Inyectar Reserva Temporal en Base de Datos (Esperando Confirmación)
    const fUrl = frontendUrl || req.headers.get('origin') || 'https://spartan-barber.com'

    // IMPORTANTE: Nunca enviar el campo 'id' del frontend a Supabase.
    // El frontend puede mandar id: Date.now() (13 dígitos) que excede el rango
    // del tipo integer/serial de Supabase y causa que el INSERT falle silenciosamente.
    // Construimos un objeto limpio con solo los campos conocidos.
    const bookingToInsert = {
      name:            booking.name            || null,
      phone:           booking.phone           || null,
      email:           booking.email           || null,
      rut:             booking.rut             || null,
      service:         booking.service         || null,
      price:           booking.price           || null,
      duration:        booking.duration        || null,
      date:            booking.date            || null,
      time:            booking.time            || null,
      barber:          booking.barber          || null,
      points_earned:   booking.points_earned   || 0,
      payment_method:  'Webpay Plus',
      attended:        false,
      status:          'waiting_payment',
      created_at:      new Date().toISOString(), // SIEMPRE usar la hora del servidor (UTC) para evitar bugs de limpieza
      notes: `${booking.notes || ''} | [TBK_TOKEN:${txData.token}] | [FRONT_URL:${fUrl}]`.trim(),
    }

    const { data: dbData, error: dbError } = await supabaseClient.from('bookings').insert(bookingToInsert).select()
    if (dbError) {
      // Si el error es un conflicto de UNIQUE index (23505), devolver conflict
      if (dbError.code === '23505') {
        console.warn(`[CONFLICT DB] Constraint UNIQUE violado: ${bookingToInsert.barber} | ${bookingToInsert.date} ${bookingToInsert.time}`)
        return new Response(
          JSON.stringify({ conflict: true, message: 'Horario ya reservado (constraint DB).' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
        )
      }
      console.error("DB Reservation Error:", dbError)
      throw new Error("Error al guardar reserva en Base de Datos local. Código: " + dbError.code)
    }

    // 5. Entregar Llave al Frontend para Inyección y Vuelo
    return new Response(
      JSON.stringify({
        token: txData.token,
        url: txData.url,
        dbData: dbData,
        dbError: dbError
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
