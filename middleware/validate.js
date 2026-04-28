import { z } from "zod";

export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      field: e.path[0],
      message: e.message,
    }));
    return res.status(400).json({ errors });
  }
  req.body = result.data;
  next();
};

// ── Auth schemas ──────────────────────────────
export const registerSchema = z.object({
  name:     z.string().min(2, "Name must be at least 2 characters"),
  email:    z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  bio:      z.string().optional(),
});

export const loginSchema = z.object({
  email:    z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const otpSchema = z.object({
  email: z.string().email("Invalid email address"),
  otp:   z.string().length(6, "OTP must be 6 digits"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  email:        z.string().email("Invalid email address"),
  otp:          z.string().length(6, "OTP must be 6 digits"),
  new_password: z.string().min(8, "Password must be at least 8 characters"),
});

// ── Profile schemas ───────────────────────────
export const editProfileSchema = z.object({
  name:   z.string().min(2).optional(),
  bio:    z.string().optional(),
  avatar: z.string().url("Avatar must be a valid URL").optional(),
});

// ── Project schemas ───────────────────────────
export const createProjectSchema = z.object({
  title:       z.string().min(1, "Title is required").max(100),
  description: z.string().max(500).optional(),
});

export const inviteSchema = z.object({
  email: z.string().email("Invalid email address"),
  role:  z.enum(["viewer", "editor", "admin"], { errorMap: () => ({ message: "Role must be viewer, editor or admin" }) }),
});

// ── Task schemas ──────────────────────────────
export const createTaskSchema = z.object({
  title:       z.string().min(1, "Title is required").max(100),
  description: z.string().max(500).optional(),
  status:      z.enum(["todo", "in_progress", "done"]).optional(),
  due_date:    z.string().optional(),
  assigned_to: z.string().uuid("Invalid user ID").optional(),
});