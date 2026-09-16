// Test the EXACT same payload the frontend sends when booking
async function run() {
  const booking = {
    name: 'Diego Test Diagnostico',
    rut: '12.345.678-9',
    phone: '+56912345678',
    email: '',
    notes: '',
    service: 'Corte de Cabello',
    price: '.690',
    duration: '45 min',
    date: '2026-09-17',
    time: '10:00',
    barber: 'Victor Lillo',
    created_at: new Date().toISOString(),
    payment_method: 'Webpay Plus (Online)',
    status: 'waiting_payment',
    points_earned: 0
  };

  const response = await fetch("https://hgxayxrszmcmmrrwxlxz.supabase.co/functions/v1/create-webpay-tx", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0'
    },
    body: JSON.stringify({
      title: 'Corte de Cabello',
      price: 16690,
      payer_name: 'Diego Test Diagnostico',
      booking: booking,
      frontendUrl: 'https://www.spartanbarber.cl/'
    })
  });
  
  const result = await response.json();
  console.log("Response status:", response.status);
  console.log("Response body:", JSON.stringify(result, null, 2));
  
  if (result.token) {
    console.log("\n? Token received:", result.token);
    console.log("dbData:", JSON.stringify(result.dbData, null, 2));
    console.log("dbError:", JSON.stringify(result.dbError, null, 2));
  }
}
run();
