import express from "express";
import crypto from "crypto";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { transporter } from "../config/mailer.js";
import { validate, createProjectSchema, inviteSchema, createTaskSchema } from "../middleware/validate.js";
import { inviteLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// ─────────────────────────────────────────
// POST /project — Create a project
// ─────────────────────────────────────────
router.post("/", requireAuth, validate(createProjectSchema), async (req, res) => {
  const { title, description } = req.body;
  try {
    const { data, error } = await supabase
      .from("projects")
      .insert([{ user_id: req.user.id, title, description: description || null }])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ message: "Project created", project: data });
  } catch (err) {
    console.error("[create-project]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /project — Get all my projects
// ─────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, title, description, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ projects: data });
  } catch (err) {
    console.error("[get-projects]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// POST /project/accept-invite — MUST be before /:id
// ─────────────────────────────────────────
router.post("/accept-invite", requireAuth, async (req, res) => {
  const { project_id, token } = req.query;

  if (!token || !project_id) {
    return res.status(400).json({ error: "Invalid invitation link" });
  }

  try {
    const { data: invite, error: inviteError } = await supabase
      .from("project_invitations")
      .select("*")
      .eq("token", token)
      .eq("project_id", project_id)
      .eq("email", req.user.email)
      .single();

    if (inviteError || !invite) {
      return res.status(400).json({ error: "Invalid or wrong invitation link" });
    }

    if (invite.status === "accepted") {
      return res.status(400).json({ error: "Invitation already accepted" });
    }

    if (new Date() > new Date(invite.expires_at)) {
      return res.status(400).json({ error: "Invitation has expired" });
    }

    const { error: memberError } = await supabase
      .from("project_members")
      .upsert([{ project_id, user_id: req.user.id, role: invite.role }],
        { onConflict: "project_id, user_id" });

    if (memberError) throw memberError;

    await supabase
      .from("project_invitations")
      .update({ status: "accepted" })
      .eq("token", token);

    const { data: project } = await supabase
      .from("projects")
      .select("id, title, description, created_at")
      .eq("id", project_id)
      .single();

    return res.status(200).json({
      message: "Invitation accepted, you have joined the project",
      role: invite.role,
      project,
    });
  } catch (err) {
    console.error("[accept-invite]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /project/:id — Get specific project
// ─────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, title, description, user_id, created_at")
      .eq("id", id)
      .single();

    if (error || !data) return res.status(404).json({ error: "Project not found" });

    const isOwner = data.user_id === req.user.id;
    if (!isOwner) {
      const { data: member } = await supabase
        .from("project_members")
        .select("id")
        .eq("project_id", id)
        .eq("user_id", req.user.id)
        .single();
      if (!member) return res.status(403).json({ error: "Access denied" });
    }

    return res.status(200).json({ project: data });
  } catch (err) {
    console.error("[get-project]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// PATCH /project/:id — Update project
// ─────────────────────────────────────────
router.patch("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, description } = req.body;

  if (!title && description === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const updates = {};
  if (title) updates.title = title;
  if (description !== undefined) updates.description = description;
  updates.updated_at = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: "Project not found" });
    return res.status(200).json({ message: "Project updated", project: data });
  } catch (err) {
    console.error("[update-project]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// DELETE /project/:id — Delete project
// ─────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from("projects")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: "Project not found" });
    return res.status(200).json({ message: "Project deleted" });
  } catch (err) {
    console.error("[delete-project]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// POST /project/:id/invite — Invite user by email
// ─────────────────────────────────────────
router.post("/:id/invite", inviteLimiter, requireAuth, validate(inviteSchema), async (req, res) => {
  const { id: project_id } = req.params;
  const { email, role } = req.body;
 try {
  
  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", project_id)
    .eq("user_id", req.user.id)
    .single();

  if (!project) {
    return res.status(403).json({ error: "Not authorized to invite to this project" });
  }

  if (email === req.user.email) {
    return res.status(400).json({ error: "You cannot invite yourself" });
  }

 
    const token = crypto.randomUUID();
    const expires_at = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const { error: dbError } = await supabase
      .from("project_invitations")
      .upsert([{ project_id, invited_by: req.user.id, email, role, token, status: "pending", expires_at }],
        { onConflict: "project_id, email" });

    if (dbError) throw dbError;

    const acceptLink = `${process.env.FRONTEND_URL}/project/accept-invite?project_id=${project_id}&token=${token}`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: `You've been invited to "${project.title}"`,
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:auto">
          <h2>You've been invited!</h2>
          <p>You have been invited to join <strong>${project.title}</strong> as a <strong>${role}</strong>.</p>
          <p>Click the button below to accept:</p>
          <a href="${acceptLink}"
             style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;
                    text-decoration:none;border-radius:6px;font-weight:bold;margin:16px 0">
            Accept Invitation
          </a>
          <p style="color:#888;font-size:12px">This invite expires in <strong>48 hours</strong>.</p>
          <p style="color:#888;font-size:12px">If the button doesn't work, copy this link:<br>${acceptLink}</p>
        </div>
      `,
    });

    console.log("[invite] email sent to:", email);
    return res.status(200).json({ message: `Invitation sent to ${email}` });
  } catch (err) {
    console.error("[invite]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /project/:id/members — Get project members
// ─────────────────────────────────────────
router.get("/:id/members", requireAuth, async (req, res) => {
  const { id: project_id } = req.params;

  const { data: owner } = await supabase
    .from("projects").select("id").eq("id", project_id).eq("user_id", req.user.id).single();
  const { data: member } = await supabase
    .from("project_members").select("id").eq("project_id", project_id).eq("user_id", req.user.id).single();

  if (!owner && !member) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const { data, error } = await supabase
      .from("project_members")
      .select("id, user_id, role")
      .eq("project_id", project_id);

    if (error) throw error;

    const enriched = await Promise.all(
      data.map(async (m) => {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name, avatar")
          .eq("id", m.user_id)
          .single();
        return { ...m, name: profile?.name, avatar: profile?.avatar };
      })
    );

    return res.status(200).json({ members: enriched });
  } catch (err) {
    console.error("[get-members]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// POST /project/:id/task — Create task (owner only)
// ─────────────────────────────────────────
router.post("/:id/task", requireAuth, validate(createTaskSchema), async (req, res) => {
  const { id: project_id } = req.params;
  const { title, description, status, due_date, assigned_to } = req.body;

  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", project_id)
    .eq("user_id", req.user.id)
    .single();

  if (!project) {
    return res.status(403).json({ error: "Only the project owner can create tasks" });
  }

  if (assigned_to) {
    const { data: member } = await supabase
      .from("project_members")
      .select("id")
      .eq("project_id", project_id)
      .eq("user_id", assigned_to)
      .single();

    if (!member) {
      return res.status(400).json({ error: "Assigned user is not a member of this project" });
    }
  }

  try {
    const { data, error } = await supabase
      .from("tasks")
      .insert([{
        project_id,
        user_id: req.user.id,
        title,
        description: description || null,
        status: status || "todo",
        due_date: due_date || null,
        assigned_to: assigned_to || null,
      }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (assigned_to) {
      try {
        const { data: assignedUser } = await supabase.auth.admin.getUserById(assigned_to);
        if (assignedUser?.user?.email) {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: assignedUser.user.email,
            subject: `You've been assigned a task in "${project.title}"`,
            html: `
              <div style="font-family:sans-serif;max-width:400px;margin:auto">
                <h2>New Task Assigned</h2>
                <p>You have been assigned a new task:</p>
                <h3 style="color:#4F46E5">${data.title}</h3>
                ${data.description ? `<p>${data.description}</p>` : ""}
                ${data.due_date ? `<p>Due: <strong>${data.due_date}</strong></p>` : ""}
                <p>Status: <strong>${data.status}</strong></p>
                <a href="${process.env.APP_URL}/project/${project_id}"
                   style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;
                          text-decoration:none;border-radius:6px;font-weight:bold;margin:16px 0">
                  View Project
                </a>
              </div>
            `,
          });
        }
      } catch (emailErr) {
        console.error("[create-task] email error:", emailErr);
      }
    }

    return res.status(201).json({ message: "Task created", task: data });
  } catch (err) {
    console.error("[create-task]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /project/:id/task — Get all tasks
// ─────────────────────────────────────────
router.get("/:id/task", requireAuth, async (req, res) => {
  const { id: project_id } = req.params;

  const { data: owner } = await supabase
    .from("projects").select("id").eq("id", project_id).eq("user_id", req.user.id).single();
  const { data: member } = await supabase
    .from("project_members").select("id").eq("project_id", project_id).eq("user_id", req.user.id).single();

  if (!owner && !member) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, title, description, status, due_date, assigned_to, created_at")
      .eq("project_id", project_id)
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ tasks: data });
  } catch (err) {
    console.error("[get-tasks]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// GET /project/:id/task/:task_id — Get specific task
// ─────────────────────────────────────────
router.get("/:id/task/:task_id", requireAuth, async (req, res) => {
  const { id: project_id, task_id } = req.params;

  const { data: owner } = await supabase
    .from("projects").select("id").eq("id", project_id).eq("user_id", req.user.id).single();
  const { data: member } = await supabase
    .from("project_members").select("id").eq("project_id", project_id).eq("user_id", req.user.id).single();

  if (!owner && !member) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, title, description, status, due_date, assigned_to, created_at")
      .eq("id", task_id)
      .eq("project_id", project_id)
      .single();

    if (error || !data) return res.status(404).json({ error: "Task not found" });
    return res.status(200).json({ task: data });
  } catch (err) {
    console.error("[get-task]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// PATCH /project/:id/task/:task_id — Update task (owner only)
// ─────────────────────────────────────────
router.patch("/:id/task/:task_id", requireAuth, async (req, res) => {
  const { id: project_id, task_id } = req.params;
  const { title, description, status, due_date, assigned_to } = req.body;

  if (!title && !description && !status && !due_date && assigned_to === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", project_id)
    .eq("user_id", req.user.id)
    .single();

  if (!project) {
    return res.status(403).json({ error: "Only the project owner can update tasks" });
  }

  if (assigned_to) {
    const { data: member } = await supabase
      .from("project_members").select("id")
      .eq("project_id", project_id).eq("user_id", assigned_to).single();
    if (!member) {
      return res.status(400).json({ error: "Assigned user is not a project member" });
    }
  }

  const updates = {};
  if (title) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status) updates.status = status;
  if (due_date !== undefined) updates.due_date = due_date;
  if (assigned_to !== undefined) updates.assigned_to = assigned_to;
  updates.updated_at = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", task_id)
      .eq("project_id", project_id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: "Task not found" });

    if (assigned_to) {
      try {
        const { data: assignedUser } = await supabase.auth.admin.getUserById(assigned_to);
        if (assignedUser?.user?.email) {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: assignedUser.user.email,
            subject: `You've been assigned a task in "${project.title}"`,
            html: `
              <div style="font-family:sans-serif;max-width:400px;margin:auto">
                <h2>Task Assigned to You</h2>
                <h3 style="color:#4F46E5">${data.title}</h3>
                ${data.description ? `<p>${data.description}</p>` : ""}
                ${data.due_date ? `<p>Due: <strong>${data.due_date}</strong></p>` : ""}
                <p>Status: <strong>${data.status}</strong></p>
                <a href="${process.env.APP_URL}/project/${project_id}"
                   style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;
                          text-decoration:none;border-radius:6px;font-weight:bold;margin:16px 0">
                  View Project
                </a>
              </div>
            `,
          });
        }
      } catch (emailErr) {
        console.error("[update-task] email error:", emailErr);
      }
    }

    return res.status(200).json({ message: "Task updated", task: data });
  } catch (err) {
    console.error("[update-task]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ─────────────────────────────────────────
// DELETE /project/:id/task/:task_id — Delete task (owner only)
// ─────────────────────────────────────────
router.delete("/:id/task/:task_id", requireAuth, async (req, res) => {
  const { id: project_id, task_id } = req.params;

  const { data: project } = await supabase
    .from("projects").select("id")
    .eq("id", project_id).eq("user_id", req.user.id).single();

  if (!project) {
    return res.status(403).json({ error: "Only the project owner can delete tasks" });
  }

  try {
    const { data, error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", task_id)
      .eq("project_id", project_id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: "Task not found" });
    return res.status(200).json({ message: "Task deleted" });
  } catch (err) {
    console.error("[delete-task]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;