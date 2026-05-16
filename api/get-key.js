module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
  }

  // Basic referer check — not bulletproof, but prevents casual abuse
  const referer = req.headers.referer || req.headers.origin || '';
  const host = req.headers.host || '';
  const allowed = referer.includes(host) || referer === '' || host.includes('localhost');

  if (!allowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.status(200).json({ key: apiKey });
};
