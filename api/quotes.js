// Vercel serverless function: /api/quotes
//   /api/quotes?symbol=VUSA.LON   -> daily closes for a ticker (newest first)
//   /api/quotes?from=GBP          -> daily GBP->ILS exchange-rate closes (newest first)
// Needs the ALPHA_VANTAGE_KEY environment variable (Vercel > Settings > Environment Variables).
// One upstream request per call, so the browser can pace calls to stay under the free-tier limit.
module.exports = async (req, res) => {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) return res.status(500).json({ error: 'ALPHA_VANTAGE_KEY is not set in Vercel' });

  const q = req.query || {};
  let url;
  if (q.symbol && /^[A-Za-z0-9.\-^]{1,20}$/.test(q.symbol)) {
    url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(q.symbol)}&outputsize=compact&apikey=${key}`;
  } else if (q.from && /^[A-Za-z]{3}$/.test(q.from)) {
    url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${q.from.toUpperCase()}&to_symbol=ILS&outputsize=compact&apikey=${key}`;
  } else {
    return res.status(400).json({ error: 'Use ?symbol=VUSA.LON or ?from=GBP' });
  }

  try {
    const r = await fetch(url);
    const j = await r.json();
    const series = j['Time Series (Daily)'] || j['Time Series FX (Daily)'];
    if (!series) {
      const msg = j['Note'] || j['Information'] || j['Error Message'] || 'No data returned';
      const limited = /rate limit|requests per|per day|per minute|call frequency|premium/i.test(msg);
      return res.status(limited ? 429 : 502).json({ error: msg, limited });
    }
    const rows = Object.entries(series)
      .map(([d, v]) => [d, parseFloat(v['4. close'])])
      .filter(r => isFinite(r[1]))
      .sort((a, b) => (a[0] < b[0] ? 1 : -1));
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({ rows });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the price provider' });
  }
};
