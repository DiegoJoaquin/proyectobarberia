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
    const { booking_id } = await req.json()
    if (!booking_id) return new Response(JSON.stringify({ error: "Booking ID missing" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Obtener Booking
    const { data: booking, error: fetchErr } = await supabaseClient
      .from('bookings')
      .select('*')
      .eq('id', booking_id)
      .single()

    if (fetchErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking no encontrada" }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 2. Extraer TBK_TOKEN
    const notes = booking.notes || ""
    const tokenMatch = notes.match(/\[TBK_TOKEN:(.*?)\]/)
    const token = tokenMatch ? tokenMatch[1] : null

    if (!token) {
      // Si no hay token de webpay, igual cancelamos el turno pero sin procesar reembolso en TBK
      await supabaseClient.from('bookings').update({ status: 'cancelled' }).eq('id', booking_id)
      return new Response(JSON.stringify({ message: "Reserva cancelada pero no se pudo hacer reembolso automático (Token Webpay no encontrado)." }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 3. Obtener monto (Parsear el str de precio ej. "$16.690")
    const numPrice = parseInt(String(booking.price || '').replace(/[^0-9]/g, '')) || 0
    // Devolvemos el 50%
    const refundAmount = Math.round(numPrice * 0.5)

    if (refundAmount <= 0) {
       await supabaseClient.from('bookings').update({ status: 'cancelled' }).eq('id', booking_id)
       return new Response(JSON.stringify({ message: "Reserva cancelada (Monto 0)." }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 4. Conectar con Transbank
    const TBK_COMMERCE_CODE = Deno.env.get('TBK_COMMERCE_CODE') || "597055555532"
    const TBK_API_KEY = Deno.env.get('TBK_API_KEY') || "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C"
    const TBK_ENVIRONMENT = Deno.env.get('TBK_ENVIRONMENT') || "INTEGRATION"
    const tbkBaseUrl = TBK_ENVIRONMENT === "PRODUCTION" ? 'https://webpay3g.transbank.cl' : 'https://webpay3gint.transbank.cl'

    const txResponse = await fetch(`${tbkBaseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions/${token}/refunds`, {
      method: 'POST',
      headers: { 
        'Tbk-Api-Key-Id': TBK_COMMERCE_CODE, 
        'Tbk-Api-Key-Secret': TBK_API_KEY, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ amount: refundAmount })
    })

    const txData = await txResponse.json()

    if (txResponse.ok && (txData.type === 'NULLIFIED' || txData.type === 'REVERSED')) {
      // Reembolso Exitoso
      const successAppend = ` [DEVOLUCIÓN_50%_OK: $${refundAmount}]`
      await supabaseClient.from('bookings').update({ 
        status: 'cancelled', 
        notes: notes.trim() + successAppend 
      }).eq('id', booking.id)

      return new Response(JSON.stringify({ message: `Reembolso automático de $${refundAmount} completado con éxito. Reserva liberada.`, transbankResponse: txData }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } else {
      // Si la API falla o da error (ej. balance insuficiente, token no válido)
      return new Response(JSON.stringify({ error: `Transbank rechazó el reembolso: ${txData.error_message || 'Transacción no anulable'}`, transbankData: txData }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

  } catch (error) {
    console.error("Error en refund-webpay-tx:", error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
