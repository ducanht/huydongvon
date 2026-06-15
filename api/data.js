// ==========================================
// Vercel Serverless Function: /api/data
// Proxy POST requests từ browser → Google Apps Script
// ==========================================

export default async function handler(req, res) {
  // Chỉ cho phép POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const GAS_URL = process.env.APPS_SCRIPT_URL;
  if (!GAS_URL) {
    console.error('[Vercel Proxy] APPS_SCRIPT_URL chưa được cấu hình trong Environment Variables!');
    return res.status(500).json({
      status: 'error',
      message: 'Server chưa cấu hình đúng. Liên hệ Admin.',
    });
  }

  try {
    // Forward request body nguyên vẹn đến GAS
    const body = JSON.stringify(req.body);

    const gasResponse = await fetch(GAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain', // GAS yêu cầu text/plain với doPost
      },
      body: body,
      redirect: 'follow', // GAS thường redirect một lần
    });

    if (!gasResponse.ok) {
      const errText = await gasResponse.text();
      console.error('[Vercel Proxy] GAS trả lỗi HTTP:', gasResponse.status, errText);
      return res.status(502).json({
        status: 'error',
        message: `GAS Backend lỗi HTTP ${gasResponse.status}`,
      });
    }

    const responseText = await gasResponse.text();

    // Cố gắng parse JSON, nếu không được thì trả text
    try {
      const jsonData = JSON.parse(responseText);
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(jsonData);
    } catch (parseErr) {
      // GAS có thể trả HTML lỗi - forward nguyên si
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(responseText);
    }
  } catch (err) {
    console.error('[Vercel Proxy] Fetch lỗi:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Không thể kết nối đến máy chủ Google Apps Script: ' + err.message,
    });
  }
}
