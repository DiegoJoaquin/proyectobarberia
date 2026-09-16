const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hgxayxrszmcmmrrwxlxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0');
async function run() {
  // Get all waiting_payment bookings from the last 2 hours
  const twoHoursAgo = new Date(Date.now() - 2*60*60*1000).toISOString();
  const { data, error } = await supabase.from('bookings').select('id, name, status, notes, created_at, barber')
    .gte('created_at', twoHoursAgo)
    .order('created_at', { ascending: false });
  console.log(JSON.stringify(data, null, 2));
  if (error) console.error(error);
}
run();
