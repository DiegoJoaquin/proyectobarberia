const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hgxayxrszmcmmrrwxlxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0');
async function run() {
  const tk = 'TEST_TOKEN_456';
  const notes = ` | [TBK_TOKEN:${tk}] | [FRONT_URL:http://localhost]`;
  
  const { data: ins, error: insErr } = await supabase.from('bookings').insert({
    name: 'TEST',
    phone: null,
    status: 'waiting_payment',
    notes: notes,
    date: '2026-09-15',
    time: '11:00',
    barber: 'Victor Lillo'
  }).select();
  console.log("INSERT with NULL:", ins, insErr);

  const { data: ins2, error: insErr2 } = await supabase.from('bookings').insert({
    name: 'TEST',
    phone: '+56912345678',
    status: 'waiting_payment',
    notes: notes,
    date: '2026-09-15',
    time: '11:00',
    barber: 'Victor Lillo'
  }).select();
  console.log("INSERT with PHONE:", ins2, insErr2);

  const { data: sel, error: selErr } = await supabase.from('bookings').select('*').filter('notes', 'ilike', `%[TBK_TOKEN:${tk}]%`);
  console.log("SELECT:", sel, selErr);
  
  if (ins2 && ins2.length) {
    await supabase.from('bookings').delete().eq('id', ins2[0].id);
  }
}
run();
