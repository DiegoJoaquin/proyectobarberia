async function run() {
  // Simulate Transbank return with the waiting token
  const token = '1131114d155ff33f00a47a59aebb6727e8e9c9b9d97c6897e9e8453fa57461fd';
  const response = await fetch("https://hgxayxrszmcmmrrwxlxz.supabase.co/functions/v1/webpay-return", {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: "token_ws=" + token,
    redirect: 'manual'
  });
  console.log("Status:", response.status, "Location:", response.headers.get('location'));
}
run();
