import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  try {
    let body = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch (e) {
        body = {};
      }
    }

    const action = event.queryStringParameters?.action || body.action;

    // 1. AMBIL DATA PENGGUNA & RANKING KMP
    if (action === "sync" || event.httpMethod === "GET") {
      const users = await db.execute("SELECT id, username, email, phone, first_name, last_name, role, domicile, photo_url, qr_code_token FROM users");
      const kmp = await db.execute(`
        SELECT u.id, u.first_name, u.last_name, u.role, u.photo_url, COALESCE(SUM(k.points), 0) AS total_points
        FROM users u
        LEFT JOIN kmp_activities k ON u.id = k.user_id
        GROUP BY u.id
        ORDER BY total_points DESC
      `);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "success",
          users: users.rows,
          kmp_ranking: kmp.rows,
        }),
      };
    }

    // 2. REGISTRASI AKUN BARU
    if (action === "register" && event.httpMethod === "POST") {
      await db.execute({
        sql: `INSERT INTO users (username, email, phone, first_name, last_name, role, domicile, password_hash, qr_code_token, is_verified) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [
          body.username.toLowerCase(),
          body.email.toLowerCase(),
          body.phone,
          body.firstName,
          body.lastName,
          body.role,
          body.domicile.toUpperCase(),
          body.password,
          `QR_${body.username.toUpperCase()}_${Date.now()}`
        ]
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: "success", message: "Pendaftaran berhasil" }),
      };
    }

    // 3. LOGIN AKUN
    if (action === "login" && event.httpMethod === "POST") {
      const res = await db.execute({
        sql: "SELECT * FROM users WHERE (username = ? OR email = ? OR phone = ?) AND password_hash = ? LIMIT 1",
        args: [body.identifier, body.identifier, body.identifier, body.password]
      });

      if (res.rows.length === 0) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ status: "error", message: "Akun atau password salah" }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: "success", user: res.rows[0] }),
      };
    }

    // 4. SCAN QR PRESENSI
    if (action === "attendance" && event.httpMethod === "POST") {
      const userRes = await db.execute({
        sql: "SELECT id FROM users WHERE qr_code_token = ? LIMIT 1",
        args: [body.qr_code_token]
      });

      if (userRes.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ status: "error", message: "QR Code tidak valid" }),
        };
      }

      const userId = userRes.rows[0].id;

      await db.execute({
        sql: "INSERT INTO attendances (user_id, session_name, status) VALUES (?, ?, ?)",
        args: [userId, body.session_name || "Presensi Rutin", "Hadir"]
      });

      await db.execute({
        sql: "INSERT INTO kmp_activities (user_id, activity_name, points) VALUES (?, ?, 10)",
        args: [userId, "Presensi Kehadiran"]
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: "success", message: "Presensi berhasil dicatat" }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ status: "error", message: "Aksi tidak dikenali" }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ status: "error", message: error.message }),
    };
  }
}
