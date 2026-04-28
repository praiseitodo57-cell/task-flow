import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { validate, editProfileSchema } from "../middleware/validate.js";

const router = express.Router();

// ─────────────────────────────────────────
// GET /user/profile — Get own profile
// ─────────────────────────────────────────
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, name, bio, avatar, created_at")
      .eq("id", req.user.id)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.status(200).json({
      user: {
        id: profile.id,
        name: profile.name,
        bio: profile.bio,
        avatar: profile.avatar,
        email: req.user.email,
        created_at: profile.created_at,
      },
    });
  } catch (err) {
    console.error("[get-profile]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// PATCH /user/profile — Edit own profile
// ─────────────────────────────────────────
router.patch("/profile", requireAuth, validate(editProfileSchema), async (req, res) => {
  const { name, bio, avatar } = req.body;

  if (!name && bio === undefined && !avatar) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const updates = {};
  if (name) updates.name = name;
  if (bio !== undefined) updates.bio = bio;
  if (avatar) updates.avatar = avatar;
  updates.updated_at = new Date().toISOString();

  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", req.user.id)
      .select("id, name, bio, avatar, created_at, updated_at")
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({
      message: "Profile updated successfully",
      user: {
        id: profile.id,
        name: profile.name,
        bio: profile.bio,
        avatar: profile.avatar,
        email: req.user.email,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      },
    });
  } catch (err) {
    console.error("[edit-profile]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /user/all — Get all users (admin only)
// ─────────────────────────────────────────
router.get("/all", requireAuth, async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 20;
  const from  = (page - 1) * limit;
  const to    = from + limit - 1;

  try {
    const { data: profiles, error, count } = await supabase
      .from("profiles")
      .select("id, name, bio, avatar", { count: "exact" })
      .range(from, to)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({
      users: profiles,
      pagination: {
        page,
        limit,
        total: count,
        total_pages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error("[get-users]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
