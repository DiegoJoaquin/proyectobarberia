// ============================================================
//  Spartan Barber — send-booking-whatsapp
//  DESACTIVADO: El envío automático fue reemplazado por botones
//  manuales en el frontend (cliente) y en el admin (dueño).
//  Esta función ya no envía mensajes para evitar costos de Twilio.
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  // Función desactivada — retorna OK sin hacer nada
  console.log('[send-booking-whatsapp] Función desactivada. No se envió ningún mensaje.');
  return new Response(JSON.stringify({ disabled: true, message: 'Envío automático desactivado.' }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
