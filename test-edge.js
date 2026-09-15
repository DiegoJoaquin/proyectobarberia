const { createClient } = require('@supabase/supabase-js');
async function run() {
  const reqBody = {
    title: "Retoque de Barba",
    price: 12500,
    payer_name: "jose vega",
    frontendUrl: "https://www.spartanbarber.cl",
    booking: {
      name: "jose vega",
      rut: "13.097.529-1",
      phone: "+56912345678",
      email: "",
      notes: "Test Webpay",
      service: "Retoque de Barba",
      price: "$12.500",
      duration: "30 min",
      date: "2026-09-17",
      time: "11:00",
      barber: "Victor Lillo",
      points_earned: 0,
      payment_method: "Webpay Plus",
      status: "waiting_payment",
      created_at: new Date().toISOString()
    }
  };

  const response = await fetch("https://hgxayxrszmcmmrrwxlxz.supabase.co/functions/v1/create-webpay-tx", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhneGF5eHJzem1jbW1ycnd4bHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwOTU4MjgsImV4cCI6MjA4ODY3MTgyOH0.0l74BmKm6GqPa50tRbUt46I2nzavr4X8XxQfxsclUc0'
    },
    body: JSON.stringify(reqBody)
  });
  
  const text = await response.text();
  console.log("Response:", response.status, text);
}
run();
