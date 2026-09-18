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

    const query = event.queryStringParameters || {};
    const action = query.action || query.type || body.action || body.type;
    const payload = body.payload || {};

    // 1. LOGIN ADMIN (Sesuai panggilan dari frontend)
    if (action === "adminLogin") {
      const inputPass = payload.masterPassword || body.masterPassword || body.password || "";
      const MASTER_PASS = "khazzanah26";

      if (inputPass === MASTER_PASS) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            status: "success",
            success: true,
            result: "success",
            token: "admin_token_active_" + Date.now(),
            message: "Login admin berhasil"
          }),
        };
      } else {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            status: "error",
            success: false,
            message: "Password Admin tidak valid"
          }),
        };
      }
    }

    // 2. GET SEMUA DATA / SYNC / INIT
    if (!action || action === "sync" || action === "init" || action === "get_all" || action === "getData" || event.httpMethod === "GET") {
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
          success: true,
          result: "success",
          users: users.rows,
          kmp_ranking: kmp.rows,
          attendances: attendances.rows,
          data: {
            users: users.rows,
            kmp_ranking: kmp.rows,
            attendances: attendances.rows
          }
        }),
      };
    }

    // 3. LOGIN USER REGULER
    if (action === "login") {
      const idVal = (payload.identifier || body.identifier || body.username || body.email || "").trim();
      const passVal = (payload.password || body.password || "").trim();

      const res = await db.execute({
        sql: "SELECT * FROM users WHERE (username = ? OR email = ? OR phone = ?) AND password_hash = ? LIMIT 1",
        args: [idVal, idVal, idVal, passVal]
      });

      if (res.rows.length === 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ status: "error", success: false, message: "Username atau Password salah" }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "success",
          success: true,
          result: "success",
          user: res.rows[0],
          data: res.rows[0]
        }),
      };
    }

    // 4. REGISTRASI
    if (action === "register") {
      const data = payload.username ? payload : body;
      await db.execute({
        sql: `INSERT INTO users (username, email, phone, first_name, last_name, role, domicile, password_hash, qr_code_token, is_verified) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [
          (data.username || "").toLowerCase().trim(),
          (data.email || "").toLowerCase().trim(),
          (data.phone || "").trim(),
          data.firstName || data.first_name || "",
          data.lastName || data.last_name || "",
          data.role || "User",
          (data.domicile || "").toUpperCase(),
          data.password || data.password_hash || "",
          `QR_${(data.username || "USER").toUpperCase()}_${Date.now()}`
        ]
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: "success", success: true, result: "success", message: "Registrasi berhasil" }),
      };
    }

    // FALLBACK RESPON UNIVERSAL
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: "success",
        success: true,
        result: "success",
        data: []
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ status: "error", success: false, message: err.message }),
    };
  }
}
