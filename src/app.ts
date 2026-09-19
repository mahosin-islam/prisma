import express from "express";
import cors from "cors";
import mainRouter from "./routers/router.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";

const app = express();

// ─── Middleware ───
app.use(cors());


app.use(cors({
  origin: ["http://localhost:3000"],
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Base route ───
app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "LMS API is running",
  });
});

// ─── API routes ───
app.use("/api/v1", mainRouter);

// ─── 404 handler (সব রাউটের পরে) ───
app.use(notFoundHandler);

// ─── Global error handler (সবার শেষে) ───
app.use(errorHandler);

export default app;