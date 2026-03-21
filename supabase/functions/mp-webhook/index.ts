import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

const SUPABASE_URL = 'https://hgxayxrszmcmmrrwxlxz.supabase.co'
// Usamos el token anónimo por defecto inyectado en Edge Functions
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
// El token de MP que setearemos en Supabase
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const topic = url.searchParams.get("topic") || url.searchParams.get("type");
    
    const bodyText = await req.text()
    const payload = bodyText ? JSON.parse(bodyText) : {}

    const action = payload.action || topic;
    const paymentId = payload.data?.id || url.searchParams.get("data.id");

    // MP notifica múltiples eventos, solo nos interesan actualizaciones de pagos
    if ((action?.includes('payment') || topic?.includes('payment')) && paymentId) {
      
      // 1. Por seguridad NO confiamos en el payload, vamos a preguntarle directo a MP
      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const paymentData = await mpResponse.json();

      // 2. Si el pago fue aprobado y completado exitosamente:
      if (paymentData.status === 'approved') {
        const meta = paymentData.metadata;
        
        // Si no hay metadata (alguien pagó un QR manual o link genérico ajeno a la web), abortamos
        if (!meta || !meta.time) return new Response("Ok (ignorado sin metadata)", { status: 200 });

        const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        // 3. Revisar si el cliente existe (Upsert)
        const { data: existingClient } = await sb
          .from('clients')
          .select('id, name, email')
          .eq('phone', meta.phone)
          .maybeSingle();

        let clientId;
        if (existingClient) {
          clientId = existingClient.id;
          // Actualizamos datos en caso de ser mejores
          await sb.from('clients').update({
            name: meta.name || existingClient.name,
            email: meta.email || existingClient.email,
            rut: meta.rut || existingClient.rut,
            updated_at: new Date().toISOString()
          }).eq('id', clientId);
        } else {
          // Creamos perfil nuevo
          const { data: newClient } = await sb.from('clients').insert({
            name: meta.name,
            phone: meta.phone,
            email: meta.email || null,
            rut: meta.rut || null,
            points: 0,
            total_visits: 0,
          }).select('id').single();
          clientId = newClient?.id;
        }

        // 4. Guardar la reserva en Supabase de forma Oficial
        await sb.from('bookings').insert({
          name: meta.name,
          phone: meta.phone,
          email: meta.email || null,
          notes: meta.notes || 'Pago Adelantado con MercadoPago',
          service: meta.service,
          price: meta.price, // ej. "$34.190"
          duration: meta.duration,
          date: meta.date,
          time: meta.time,
          barber: meta.barber,
          payment_method: 'MercadoPago',
          attended: false, // Entra como 'Pendiente de atender', pero con método MercadoPago
          client_id: clientId,
          created_at: new Date().toISOString()
        });
      }
    }

    // Siempre responder 200 OK a MP rápido para que no re-intente enviar el webhook miles de veces
    return new Response("OK", { status: 200 })
  } catch (error) {
    console.error('Webhook Error crítico:', error)
    return new Response("Internal Server Error", { status: 500 })
  }
})
