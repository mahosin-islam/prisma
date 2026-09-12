import express from "express";
import cors from "cors";
import mainRouter from "./routers/router.js";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Base Route setup
app.use("/api/v1", mainRouter);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to my API",
  });
});

export default app;