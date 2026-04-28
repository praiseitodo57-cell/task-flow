import { supabase } from "../config/supabase.js";

// ─────────────────────────────────────────
// requireAuth — validates Bearer token
// ─────────────────────────────────────────
export const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized — no token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Unauthorized — invalid token" });
    }

    req.user = data.user;
    next();
  } catch (err) {
    console.error("[requireAuth]", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// ─────────────────────────────────────────
// requireAdmin — must run after requireAuth
// ─────────────────────────────────────────
export const requireAdmin = (req, res, next) => {
  const role = req.user?.user_metadata?.role || req.user?.role;

  if (role !== "admin") {
    return res.status(403).json({ error: "Access denied. Admins only." });
  }

  next();
};
