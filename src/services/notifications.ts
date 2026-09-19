import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const notificationRouter = Router();

notificationRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// 1. GET /my/:userId — Get all notifications for a user
//    Query: ?unreadOnly=true
// ═══════════════════════════════════════════════════════════
notificationRouter.get("/my/:userId", async (req, res, next) => {
  try {
    const userId = req.params.userId as string;
    const unreadOnly = req.query.unreadOnly === "true";

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly && { isRead: false }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        batch: { select: { id: true, batchNumber: true, title: true } },
      },
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    sendResponse({
      res,
      message: "Notifications fetched successfully",
      data: {
        notifications,
        total: notifications.length,
        unreadCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 2. GET /unread-count/:userId — Get unread count only
// ═══════════════════════════════════════════════════════════
notificationRouter.get("/unread-count/:userId", async (req, res, next) => {
  try {
    const userId = req.params.userId as string;

    const count = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    sendResponse({
      res,
      message: "Unread count fetched",
      data: { unreadCount: count },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. POST /send — Send notification to one user (ADMIN only)
//    Body: { userId, batchId?, type, title, message, link? }
// ═══════════════════════════════════════════════════════════
notificationRouter.post(
  "/send",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const { userId, batchId, type, title, message, link } = req.body;

      if (!userId || !type || !title || !message) {
        throw new AppError("userId, type, title, message are required", 400);
      }

      const notification = await prisma.notification.create({
        data: {
          userId,
          batchId: batchId ?? null,
          type,
          title,
          message,
          link: link ?? null,
        },
      });

      sendResponse({
        res,
        statusCode: 201,
        message: "Notification sent successfully",
        data: notification,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 4. POST /broadcast — Send to all students of a batch/course (ADMIN only)
//    Body: { batchId? | courseId?, type, title, message, link? }
// ═══════════════════════════════════════════════════════════
notificationRouter.post(
  "/broadcast",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const { batchId, courseId, type, title, message, link } = req.body;

      if (!type || !title || !message) {
        throw new AppError("type, title, message are required", 400);
      }

      if (!batchId && !courseId) {
        throw new AppError("Either batchId or courseId is required", 400);
      }

      const enrollments = await prisma.enrollment.findMany({
        where: {
          ...(batchId && { batchId }),
          ...(courseId && { courseId }),
          status: "ACTIVE",
          isDeleted: false,
        },
        select: { learnerId: true },
      });

      if (enrollments.length === 0) {
        throw new AppError("No active students found", 404);
      }

      const result = await prisma.notification.createMany({
        data: enrollments.map((e) => ({
          userId: e.learnerId,
          batchId: batchId ?? null,
          type,
          title,
          message,
          link: link ?? null,
        })),
      });

      sendResponse({
        res,
        statusCode: 201,
        message: `Broadcast sent to ${result.count} students`,
        data: { sentCount: result.count },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 5. PATCH /read-all/:userId — Mark all as read
// ═══════════════════════════════════════════════════════════
notificationRouter.patch("/read-all/:userId", async (req, res, next) => {
  try {
    const userId = req.params.userId as string;

    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    sendResponse({
      res,
      message: `${result.count} notifications marked as read`,
      data: { updated: result.count },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 6. PATCH /:id/read — Mark a single notification as read
// ═══════════════════════════════════════════════════════════
notificationRouter.patch("/:id/read", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.notification.findUnique({ where: { id } });
    if (!exists) throw new AppError("Notification not found", 404);

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    sendResponse({
      res,
      message: "Marked as read",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 7. DELETE /clear/:userId — Delete all read notifications
// ═══════════════════════════════════════════════════════════
notificationRouter.delete("/clear/:userId", async (req, res, next) => {
  try {
    const userId = req.params.userId as string;

    const result = await prisma.notification.deleteMany({
      where: { userId, isRead: true },
    });

    sendResponse({
      res,
      message: `${result.count} read notifications cleared`,
      data: { deleted: result.count },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 8. GET /:id — Get a single notification
// ═══════════════════════════════════════════════════════════
notificationRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const notification = await prisma.notification.findUnique({
      where: { id },
      include: {
        batch: { select: { id: true, batchNumber: true, title: true } },
      },
    });

    if (!notification) throw new AppError("Notification not found", 404);

    sendResponse({
      res,
      message: "Notification fetched",
      data: notification,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 9. DELETE /:id — Delete a notification (hard delete)
// ═══════════════════════════════════════════════════════════
notificationRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.notification.findUnique({ where: { id } });
    if (!exists) throw new AppError("Notification not found", 404);

    await prisma.notification.delete({ where: { id } });

    sendResponse({ res, message: "Notification deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default notificationRouter;