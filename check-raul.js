const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hgxayxrszmcmmrrwxlxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0');
async function run() {
  // Buscar Raúl Sánchez
  const { data: raul } = await supabase.from('bookings').select('*').ilike('name', '%raul%').order('created_at', { ascending: false });
  console.log('=== RAUL ===');
  console.log(JSON.stringify(raul, null, 2));
  
  // Todos los bookings de hoy con webpay
  const { data: hoy } = await supabase.from('bookings').select('id, name, status, date, time, barber, service, notes, created_at').gte('created_at', '2026-09-16T00:00:00.000Z').order('created_at', { ascending: false });
  console.log('=== TODOS HOY ===');
  console.log(JSON.stringify(hoy, null, 2));
}
run();
