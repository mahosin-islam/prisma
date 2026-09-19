import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const userRouter = Router();

// ⚠️ আপাতত টোকেন/রোল চেক বন্ধ — পরে ফ্রন্টএন্ডের সময় যোগ করব

// ═══════════════════════════════════════════════════════════
// ১. GET / — সব ইউজার দেখা
//    URL: GET /api/v1/users?search=mahosin&role=LEARNER
// ═══════════════════════════════════════════════════════════
userRouter.get("/", async (req, res, next) => {
  try {
    const search = req.query.search as string | undefined;
    const role = req.query.role as string | undefined;

    const where = {
      isDeleted: false,
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }),
      ...(role && { role: role as "ADMIN" | "LEARNER" }),
    };

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        bio: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    sendResponse({
      res,
      message: "Users fetched successfully",
      data: { users, total: users.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ২. GET /:id — একজন ইউজার দেখা
//    URL: GET /api/v1/users/:id
// ═══════════════════════════════════════════════════════════
userRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        bio: true,
        createdAt: true,
      },
    });

    if (!user) throw new AppError("User not found", 404);

    sendResponse({ res, message: "User fetched", data: user });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৩. PATCH /:id — ইউজার আপডেট
//    URL: PATCH /api/v1/users/:id
//    Body: { name?, avatar?, bio?, role? }
// ═══════════════════════════════════════════════════════════
userRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { name, avatar, bio, role } = req.body;

    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("User not found", 404);
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(avatar !== undefined && { avatar }),
        ...(bio !== undefined && { bio }),
        ...(role && { role }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        bio: true,
        updatedAt: true,
      },
    });

    sendResponse({ res, message: "User updated", data: user });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৪. DELETE /:id — সফট ডিলিট
//    URL: DELETE /api/v1/users/:id
// ═══════════════════════════════════════════════════════════
userRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("User not found", 404);
    }

    await prisma.user.delete({
      where: { id }
    });

    sendResponse({ res, message: "User deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default userRouter;