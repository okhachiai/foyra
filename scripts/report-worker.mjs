// Stateless scheduler client. Jobs and leases live in PostgreSQL through the app.
// Never log the token or provider responses.
const token = process.env.CRON_TOKEN;
if (!token) {
  console.error('AI worker disabled: configure CRON_TOKEN for both app and worker.');
  for (;;) await new Promise((resolve) => setTimeout(resolve, 3600000));
}
for (;;) {
  try {
    const response = await fetch('http://app:3000/api/reports/process', {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25 * 60 * 1000),
    });
    if (!response.ok) throw new Error('Worker request failed');
    const result = await response.json();
    if (result.processed) continue;
  } catch {
    console.error('AI worker could not reach the app; retrying.');
  }
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
