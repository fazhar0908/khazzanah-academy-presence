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
        body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      } catch (e) {
        body = {};
      }
    }

    const queryParams = event.queryStringParameters || {};
    // Ambil action dari berbagai kemungkinan parameter (action, type, op, dll)
    const action = queryParams.action || queryParams.type || body.action || body.type;

    // 1. DEFAULT / SYNC / GET SEMUA DATA (Users, Ranking, Presensi)
    // Jika action kosong atau 'sync' atau 'init' atau 'get_all' atau request GET biasa
    if (!action || action === "sync" || action === "init" || action === "get_all" || event.httpMethod === "GET") {
      const users = await db.execute("SELECT id, username, email, phone, first_name, last_name, role, domicile, photo_url, qr_code_token, is_verified FROM users");
      
      const kmp = await db.execute(`
        SELECT u.id, u.first_name, u.last_name, u.role, u.photo_url, COALESCE(SUM(k.points), 0) AS total_points
        FROM users u
        LEFT JOIN kmp_activities k ON u.id = k.user_id
        GROUP BY u.id
        ORDER BY total_points DESC
      `);

      const attendances = await db.execute("SELECT * FROM attendances ORDER BY timestamp DESC LIMIT 100");

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "success",
          users: users.rows,
          kmp_ranking: kmp.rows,
          attendances: attendances.rows,
          // Cadangan format array jika frontend membaca langsung objeknya
          data: {
            users: users.rows,
            kmp_ranking: kmp.rows,
            attendances: attendances.rows
          }
        }),
      };
    }

    // 2. REGISTRASI
    if (action === "register") {
      await db.execute({
        sql: `INSERT INTO users (username, email, phone, first_name, last_name, role, domicile, password_hash, qr_code_token, is_verified) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [
          (body.username || "").toLowerCase(),
          (body.email || "").toLowerCase(),
          body.phone || "",
          body.firstName || body.first_name || "",
          body.lastName || body.last_name || "",
          body.role || "User",
          (body.domicile || "").toUpperCase(),
          body.password || body.password_hash || "",
          `QR_${(body.username || "USER").toUpperCase()}_${Date.now()}`
        ]
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: "success", message: "Pendaftaran berhasil" }),
      };
    }

    // 3. LOGIN
    if (action === "login") {
      const idVal = body.identifier || body.username || body.email || "";
      const passVal = body.password || "";

      const res = await db.execute({
        sql: "SELECT * FROM users WHERE (username = ? OR email = ? OR phone = ?) AND password_hash = ? LIMIT 1",
        args: [idVal, idVal, idVal, passVal]
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

    // 4. PRESENSI
    if (action === "attendance") {
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

    // Fallback jika ada action tak dikenal, tetap berikan status success data kosong agar frontend tidak crash
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: "success", message: "Aksi diterima", data: [] }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ status: "error", message: error.message }),
    };
  }
}
