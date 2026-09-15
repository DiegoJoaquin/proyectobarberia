async function run() {
  const token = '12310f6ce6890a343b708f51c677450159b008fc259e5f6aacd990155de37323';
  const response = await fetch("https://hgxayxrszmcmmrrwxlxz.supabase.co/functions/v1/webpay-return", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: "token_ws=" + token,
    redirect: 'manual'
  });
  const text = await response.text();
  console.log("Status:", response.status, "Location:", response.headers.get('location'));
  console.log("Body:", text);
}
run();
