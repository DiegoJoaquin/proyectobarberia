const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hgxayxrszmcmmrrwxlxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0');
async function run() {
  // Buscar todos los waiting_payment activos
  const { data: waiting } = await supabase.from('bookings').select('*').eq('status', 'waiting_payment').order('created_at', { ascending: false });
  console.log('=== WAITING PAYMENT ACTIVOS ===');
  console.log(JSON.stringify(waiting, null, 2));
  
  // Los dos "PAGO SIN HORA" de hoy - buscar BuyOrder en registros de Transbank via notes
  // BuyOrder:SBC-9571778696 -> sesión: 9571778696 -> creado a las 15:17 hora Chile
  // BuyOrder:SBC-9568255597 -> sesión: 9568255597 -> creado a las 14:19 hora Chile
  // Buscar reservas alrededor de esos momentos que pudieran ser el cliente
  console.log('\n=== BUSCANDO RESERVAS 14:00-15:30 HOY ===');
  const { data: horario } = await supabase.from('bookings').select('id, name, status, time, barber, notes, created_at')
    .gte('created_at', '2026-09-16T14:00:00Z')
    .lte('created_at', '2026-09-16T15:30:00Z')
    .order('created_at', { ascending: true });
  console.log(JSON.stringify(horario, null, 2));
}
run();
