const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hgxayxrszmcmmrrwxlxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0');
async function run() {
  // Check the two tokens that created PAGO SIN HORA today - look for them in waiting_payment logs
  const token1 = '1231b9d5d5bc5b93eb70454f4940fbd00453937f39963df77aa7ce6ce4243877';
  const token2 = '1131c0b158497a93046b4cf5774a4a05352e2a7bfd0af3e131b19663522c7dd3';
  
  // Search for any booking that might have had these tokens
  const { data: d1 } = await supabase.from('bookings').select('id, name, status, notes, created_at').ilike('notes', '%' + token1 + '%');
  const { data: d2 } = await supabase.from('bookings').select('id, name, status, notes, created_at').ilike('notes', '%' + token2 + '%');
  
  console.log('Token1 matches:', JSON.stringify(d1, null, 2));
  console.log('Token2 matches:', JSON.stringify(d2, null, 2));
}
run();
