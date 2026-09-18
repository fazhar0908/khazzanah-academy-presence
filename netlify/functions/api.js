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

  console.log("=== INCOMING REQUEST ===");
  console.log("Method:", event.httpMethod);
  console.log("Query:", JSON.stringify(event.queryStringParameters));
  console.log("Raw Body:", event.body);

  try {
    let body = {};
    if (event.body) {
      try {
        body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      } catch (e) {
        console.log("Body parse error, continuing with empty body");
      }
    }

    const query = event.queryStringParameters || {};
    const action = query.action || query.type || body.action || body.type;
    console.log("Resolved Action:", action);

    // 1. Inisialisasi / Sync / Data Awal / GET
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

    // 2. Login
    if (action === "login") {
      const idVal = body.identifier || body.username || body.email || query.identifier || query.username || "";
      const passVal = body.password || query.password || "";

      console.log("Attempt login for:", idVal);

      const res = await db.execute({
        sql: "SELECT * FROM users WHERE (username = ? OR email = ? OR phone = ?) AND password_hash = ? LIMIT 1",
        args: [idVal, idVal, idVal, passVal]
      });

      if (res.rows.length === 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ status: "error", message: "Username/Email atau Password salah" }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: "success", result: "success", user: res.rows[0], data: res.rows[0] }),
      };
    }

    // 3. Register
    if (action === "register") {
      await db.execute({
        sql: `INSERT INTO users (username, email, phone, first_name, last_name, role, domicile, password_hash, qr_code_token, is_verified) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [
          (body.username || query.username || "").toLowerCase(),
          (body.email || query.email || "").toLowerCase(),
          body.phone || query.phone || "",
          body.firstName || body.first_name || query.firstName || "",
          body.lastName || body.last_name || query.lastName || "",
          body.role || query.role || "User",
          (body.domicile || query.domicile || "").toUpperCase(),
          body.password || body.password_hash || query.password || "",
          `QR_${(body.username || "USER").toUpperCase()}_${Date.now()}`
        ]
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: "success", result: "success", message: "Pendaftaran berhasil" }),
      };
    }

    // Default fallback agar frontend tidak menerima status 400/500
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: "success", result: "success", message: "Request processed", data: [] }),
    };

  } catch (err) {
    console.error("FUNCTION ERROR:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ status: "error", message: err.message }),
    };
  }
}
