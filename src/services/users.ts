import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const userRouter = Router();
userRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// ১. GET /me — নিজের প্রোফাইল (সবার আগে!)
// ═══════════════════════════════════════════════════════════
userRouter.get("/me", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, role: true,
        avatar: true, bio: true, createdAt: true,
      },
    });
    if (!user) throw new AppError("User not found", 404);
    sendResponse({ res, message: "Profile fetched", data: user });
  } catch (error) { next(error); }
});

// ═══════════════════════════════════════════════════════════
// ২. GET / — সব ইউজার
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
        id: true, name: true, email: true, role: true,
        avatar: true, bio: true, createdAt: true,
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
// ৩. GET /:id — একজন ইউজার
// ═══════════════════════════════════════════════════════════
userRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findUnique({
      where: { 
        id,
        isDeleted: false,     // ← এখানেই চেক
      },
      select: {
        id: true, name: true, email: true, role: true,
        avatar: true, bio: true, createdAt: true,
      },
    });

    if (!user) {
      throw new AppError("User not found", 404);
    }

    sendResponse({ res, message: "User fetched", data: user });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৪. PATCH /:id — ইউজার আপডেট
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
        id: true, name: true, email: true, role: true,
        avatar: true, bio: true, updatedAt: true,
      },
    });

    sendResponse({ res, message: "User updated", data: user });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৫. DELETE /:id — সফট ডিলিট
// ═══════════════════════════════════════════════════════════
userRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("User not found", 404);
    }

    await prisma.user.update({                  // ← ✅ সফট ডিলিট
      where: { id },
      data: { isDeleted: true },
    });

    sendResponse({ res, message: "User deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default userRouter;