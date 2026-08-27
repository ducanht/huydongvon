// ==========================================
// Vercel Serverless Function: /api/data
// Proxy POST requests từ browser → Google Apps Script
// ==========================================

export default async function handler(req, res) {
  // Chỉ cho phép POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const GAS_URL = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbz20Oi5KUwMgTq0BlLn5IIYP2t03oYcO9xDcXusp3QGzVIj2N0I5JXNlCj2aYRC7L5n/exec";
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

    const responseText = await gasResponse.text();

    if (!gasResponse.ok) {
      console.error('[Vercel Proxy] GAS trả lỗi HTTP:', gasResponse.status, responseText.substring(0, 300));
      return res.status(502).json({
        status: 'error',
        message: `GAS Backend lỗi HTTP ${gasResponse.status}`,
      });
    }

    // Cố gắng parse JSON, nếu không được thì trả lỗi có cấu trúc JSON
    try {
      const jsonData = JSON.parse(responseText);
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(jsonData);
    } catch (parseErr) {
      console.error('[Vercel Proxy] GAS trả HTML/Text không phải JSON:', responseText.substring(0, 300));
      res.setHeader('Content-Type', 'application/json');
      return res.status(502).json({
        status: 'error',
        message: 'Máy chủ Google Apps Script đang bận hoặc phản hồi trang web thay vì dữ liệu JSON. Vui lòng tải lại trang sau giây lát.'
      });
    }
  } catch (err) {
    console.error('[Vercel Proxy] Fetch lỗi:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Không thể kết nối đến máy chủ Google Apps Script: ' + err.message,
    });
  }
}
