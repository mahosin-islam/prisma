import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { generateToken } from "../utils/jwt.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const authRouter = Router();

// ═══════════════════════════════════════════════════════════
// ১. Register — নতুন ইউজার তৈরি
//    POST /api/v1/auth/register
// ═══════════════════════════════════════════════════════════
authRouter.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    // ── যাচাই ──
    if (!name || !email || !password) {
      throw new AppError("Name, email, and password are required", 400);
    }

    if (password.length < 6) {
      throw new AppError("Password must be at least 6 characters", 400);
    }

    // ── ইমেইল আগে থেকে আছে কি? ──
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError("User with this email already exists", 409);
    }

    // ── পাসওয়ার্ড হ্যাশ ──
    const hashedPassword = await hashPassword(password);

    // ── ইউজার তৈরি ──
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role === "ADMIN" ? "ADMIN" : "LEARNER", // ডিফল্ট LEARNER
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        createdAt: true,
        // password বাদ — কখনো ক্লায়েন্টকে দেব না
      },
    });

    // ── টোকেন তৈরি ──
    const token = generateToken({
      userId: user.id,
      role: user.role,
      email: user.email,
    });

    sendResponse({
      res,
      statusCode: 201,
      message: "User registered successfully",
      data: { user, token },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ২. Login — লগইন করে টোকেন পাওয়া
//    POST /api/v1/auth/login
// ═══════════════════════════════════════════════════════════
authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError("Email and password are required", 400);
    }

    // ── ইউজার খোঁজো ──
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.isDeleted) {
      throw new AppError("Invalid email or password", 401);
    }

    // ── পাসওয়ার্ড যাচাই ──
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      throw new AppError("Invalid email or password", 401);
    }

    // ── টোকেন তৈরি ──
    const token = generateToken({
      userId: user.id,
      role: user.role,
      email: user.email,
    });

    // ── পাসওয়ার্ড বাদ দিয়ে রেসপন্স ──
    const { password: _, ...userWithoutPassword } = user;

    sendResponse({
      res,
      message: "Login successful",
      data: {
        user: userWithoutPassword,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default authRouter;