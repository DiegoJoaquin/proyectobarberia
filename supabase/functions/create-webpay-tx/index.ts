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

    // 1. Obtener llaves (Integración por Defecto)
    const TBK_COMMERCE_CODE = Deno.env.get('TBK_COMMERCE_CODE') || "597055555532"
    const TBK_API_KEY = Deno.env.get('TBK_API_KEY') || "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C"
    
    // Entorno Inteligente: Prueba VS Producción
    const isProd = TBK_COMMERCE_CODE !== "597055555532"
    const tbkBaseUrl = isProd 
      ? 'https://webpay3g.transbank.cl'
      : 'https://webpay3gint.transbank.cl'
      
    const sessionId = booking.id ? booking.id.toString() : Date.now().toString()
    const buyOrder = `SBC-${sessionId.slice(-10)}` // Número de pedido autogenerado
    
    // 2. URL de Retorno (Apuntando a la 2da Edge Function `webpay-return`)
    const reqUrl = new URL(req.url)
    const returnUrl = `${reqUrl.origin}/webpay-return` 

    // 3. Crear Firma Inicial Transbank
    const txPayload = {
      buy_order: buyOrder,
      session_id: sessionId,
      amount: price,
      return_url: returnUrl
    }

    const txResponse = await fetch(`${tbkBaseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions`, {
      method: 'POST',
      headers: {
        'Tbk-Api-Key-Id': TBK_COMMERCE_CODE,
        'Tbk-Api-Key-Secret': TBK_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(txPayload)
    })

    if (!txResponse.ok) {
      const err = await txResponse.text()
      console.error("Transbank Auth Error:", err)
      throw new Error("Transbank Init Error: " + err)
    }

    const txData = await txResponse.json()
    // Transbank devuelve { token: "xxxx", url: "https://...." }
    
    // 4. Inyectar Reserva Temporal en Base de Datos (Esperando Confirmación)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    const fUrl = frontendUrl || req.headers.get('origin') || 'https://spartan-barber.com'

    // Atamos el 'token' a las notas para que la segunda función pueda encontrarlo
    booking.payment_method = 'Webpay Plus'
    booking.attended = false
    booking.notes = `${booking.notes || ''} | [TBK_TOKEN:${txData.token}] | [FRONT_URL:${fUrl}]`

    const { error: dbError } = await supabaseClient.from('bookings').insert(booking)
    if (dbError) {
       console.error("DB Reservation Error:", dbError)
       throw new Error("Error al guardar reserva en Base de Datos local.")
    }

    // 5. Entregar Llave al Frontend para Inyección y Vuelo
    return new Response(
      JSON.stringify({
        token: txData.token,
        url: txData.url
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
