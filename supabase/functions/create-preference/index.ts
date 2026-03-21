import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { title, price, payer_email, payer_name, metadata } = await req.json()
    
    // El token secreto de mercado pago que configuraremos en Supabase
    const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
    
    if (!MP_ACCESS_TOKEN) {
      throw new Error('MP_ACCESS_TOKEN no está configurado en las variables de entorno de Supabase')
    }

    const payload = {
      items: [
        {
          title: title,
          description: "Reserva de sesión en Spartan Barber",
          quantity: 1,
          currency_id: "CLP",
          unit_price: price
        }
      ],
      payer: {
        email: payer_email,
        name: payer_name
      },
      metadata: metadata, // Empaquetamos invisiblemente los datos del cliente (RUT, telefono, notas, fecha, etc)
      back_urls: {
        success: "https://proyectobarberia-rho.vercel.app/?collection_status=approved",
        pending: "https://proyectobarberia-rho.vercel.app/?collection_status=pending",
        failure: "https://proyectobarberia-rho.vercel.app/?collection_status=rejected"
      },
      auto_return: "approved",
      // ESTE ES EL WEBHOOK QUE ESCUCHARÁ CUANDO ALGUIEN PAGUE:
      notification_url: "https://hgxayxrszmcmmrrwxlxz.supabase.co/functions/v1/mp-webhook"
    }

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const mpData = await mpResponse.json()
    
    // Devolvemos el Preference ID al frontend para que abra el modal
    return new Response(
      JSON.stringify({ id: mpData.id, init_point: mpData.init_point }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
