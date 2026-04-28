import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import userRouter from "./routes/user.js";
import projectRouter from "./routes/project.js";

dotenv.config();

const app = express();

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
}));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/user", userRouter);
app.use("/api/project", projectRouter);

app.get("/", (req, res) => res.json({ message: "TaskFlow API running" }));

app.listen(process.env.PORT, () => {
  console.log("Server running on port " + process.env.PORT);
});