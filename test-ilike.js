const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hgxayxrszmcmmrrwxlxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0');
async function run() {
  const tk = 'TEST_TOKEN_123';
  const notes = ` | [TBK_TOKEN:${tk}] | [FRONT_URL:http://localhost]`;
  
  const { data: ins, error: insErr } = await supabase.from('bookings').insert({
    name: 'TEST',
    status: 'waiting_payment',
    notes: notes,
    date: '2026-09-15'
  }).select();
  console.log("INSERT:", ins, insErr);
  
  const { data: sel, error: selErr } = await supabase.from('bookings').select('*').filter('notes', 'ilike', `%[TBK_TOKEN:${tk}]%`);
  console.log("SELECT:", sel, selErr);
  
  if (ins && ins.length) {
    await supabase.from('bookings').delete().eq('id', ins[0].id);
  }
}
run();
