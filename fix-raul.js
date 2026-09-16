const { createClient } = require('@supabase/supabase-js');
// Usar SERVICE ROLE KEY para poder hacer updates sin restricciones RLS
const supabase = createClient(
  'https://hgxayxrszmcmmrrwxlxz.supabase.co', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0'
);
async function run() {
  // Actualizar el PAGO SIN HORA de las 14:19 (id: 2832) ? Raúl Sánchez, 14:45
  const { data, error } = await supabase.from('bookings').update({
    name: 'Raúl Sánchez',
    time: '14:45',
    date: '2026-09-16',
    service: 'Corte de Cabello',
    price: '.690',
    barber: 'Por confirmar con admin',
    notes: '[RESCATE IDENTIFICADO] Cliente: Raúl Sánchez | Pagó .690 via Webpay | Auth:738612 | Hora original: 14:45 | TBK_TOKEN:1131c0b158497a93046b4cf5774a4a05352e2a7bfd0af3e131b19663522c7dd3'
  }).eq('id', 2832).select();
  
  console.log('Update result:', JSON.stringify(data, null, 2));
  if (error) console.error('Error:', error);
}
run();
