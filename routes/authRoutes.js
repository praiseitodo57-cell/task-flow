import express from "express";
import otpGenerator from "otp-generator";
import { supabase } from "../config/supabase.js";
import { resend } from "../config/mailer.js";
import { requireAuth } from "../middleware/auth.js";
import { validate, registerSchema, loginSchema, otpSchema, forgotPasswordSchema, resetPasswordSchema } from "../middleware/validate.js";
import { otpLimiter, loginLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

const generateOTP = () =>
  otpGenerator.generate(6, {
    digits: true,
    alphabets: false,
    specialChars: false,
  });

const getOTPExpiry = () => new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

const sendOTPEmail = async (to, otp) =>
  await resend.emails.send({
  from: "TaskFlow <onboarding@resend.dev>",
    to,
    subject: "Verify your Email",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: auto;">
        <h2>Your Verification Code</h2>
        <p style="font-size: 2rem; font-weight: bold; letter-spacing: 0.3rem;">${otp}</p>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p>If you didn't request this, please ignore this email.</p>
      </div>
    `,
  });

// ─────────────────────────────────────────
// POST /auth/register — Send OTP
// ─────────────────────────────────────────
router.post("/register", otpLimiter, validate(registerSchema), async (req, res) => {
  const { email, password, name, bio } = req.body;

  try {
    const otp = generateOTP();
    const expires_at = getOTPExpiry();

    const { error: dbError } = await supabase
      .from("email_otps")
      .upsert([{ email, otp, expires_at, password, name, bio }], { onConflict: "email" });

    if (dbError) throw dbError;

    await sendOTPEmail(email, otp);

    return res.status(200).json({ message: "OTP sent to email" });
  } catch (err) {
    console.error("[register]", err);
    return res.status(500).json({ error: "Failed to send OTP" });
  }
});

// ─────────────────────────────────────────
// POST /auth/verify-otp — Verify & Create User
// ─────────────────────────────────────────
router.post("/verify-otp", validate(otpSchema), async (req, res) => {
  const { email, otp } = req.body;

  try {
    const { data: otpRecord, error: otpError } = await supabase
      .from("email_otps")
      .select("*")
      .eq("email", email)
      .eq("otp", otp)
      .single();

    if (otpError || !otpRecord) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ error: "OTP has expired" });
    }

    const { name, bio, password } = otpRecord;

    await supabase.from("email_otps").delete().eq("email", email);

    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name, bio },
      email_confirm: true,
    });

    if (createError) {
      return res.status(400).json({ error: createError.message });
    }

    return res.status(201).json({
      message: "Account created successfully",
      user: userData.user,
    });
  } catch (err) {
    console.error("[verify-otp]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// POST /auth/login — Email + Password
// ─────────────────────────────────────────
router.post("/login", loginLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    const { user, session } = data;

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        name: profile?.name,
        bio: profile?.bio,
        avatar: profile?.avatar,
      },
      token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
    });
  } catch (err) {
    console.error("[login]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// POST /auth/refresh — Get new access token
// ─────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: "Refresh token is required" });
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token });

    if (error) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    const { session } = data;

    return res.status(200).json({
      message: "Token refreshed",
      token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
    });
  } catch (err) {
    console.error("[refresh]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// POST /auth/logout — Invalidate session
// ─────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const { error } = await supabase.auth.admin.signOut(token);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("[logout]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /auth/me — Get current user + profile
// ─────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", req.user.id)
      .single();

    if (error) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.status(200).json({
      user: {
        id: req.user.id,
        email: req.user.email,
        name: profile.name,
        bio: profile.bio,
        avatar: profile.avatar,
        created_at: profile.created_at,
      },
    });
  } catch (err) {
    console.error("[me]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// POST /auth/forgot-password — Send reset OTP
// ─────────────────────────────────────────
router.post("/forgot-password", otpLimiter, validate(forgotPasswordSchema), async (req, res) => {
  const { email } = req.body;

  try {
    const { data: users, error: userError } = await supabase.auth.admin.listUsers();

    if (userError) throw userError;

    const userExists = users.users.find((u) => u.email === email);

    if (!userExists) {
      return res.status(200).json({ message: "If this email exists, a reset code has been sent" });
    }

    const otp = generateOTP();
    const expires_at = getOTPExpiry();

    const { error: dbError } = await supabase
      .from("email_otps")
      .upsert([{ email, otp, expires_at, password: null, name: null, bio: null }], {
        onConflict: "email",
      });

    if (dbError) throw dbError;

    await resend.emails.send({
    from: "TaskFlow <onboarding@resend.dev>",
      to: email,
      subject: "Reset your Password",
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: auto;">
          <h2>Password Reset Request</h2>
          <p>Use the code below to reset your password:</p>
          <p style="font-size: 2rem; font-weight: bold; letter-spacing: 0.3rem;">${otp}</p>
          <p>This code expires in <strong>10 minutes</strong>.</p>
          <p>If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });

    return res.status(200).json({ message: "If this email exists, a reset code has been sent" });
  } catch (err) {
    console.error("[forgot-password]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// POST /auth/reset-password — Verify OTP + update password
// ─────────────────────────────────────────
router.post("/reset-password", validate(resetPasswordSchema), async (req, res) => {
  const { email, otp, new_password } = req.body;

  try {
    const { data: otpRecord, error: otpError } = await supabase
      .from("email_otps")
      .select("*")
      .eq("email", email)
      .eq("otp", otp)
      .single();

    if (otpError || !otpRecord) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ error: "OTP has expired" });
    }

    await supabase.from("email_otps").delete().eq("email", email);

    const { data: users, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) throw listError;

    const user = users.users.find((u) => u.email === email);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: new_password,
    });

    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }

    return res.status(200).json({ message: "Password reset successfully" });
  } catch (err) {
    console.error("[reset-password]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
