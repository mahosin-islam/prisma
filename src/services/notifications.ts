import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const notificationRouter = Router();

// ═══════════════════════════════════════════════════════════
// ১. GET /my/:userId — আমার সব নোটিফিকেশন
//    URL: GET /api/v1/notifications/my/:userId
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
        batch: {
          select: { id: true, batchNumber: true, title: true },
        },
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
// ২. GET /unread-count/:userId — শুধু unread সংখ্যা
//    URL: GET /api/v1/notifications/unread-count/:userId
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
// ৩. GET /:id — একটা নোটিফিকেশন দেখা
//    URL: GET /api/v1/notifications/:id
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
// ৪. PATCH /:id/read — পড়া হিসেবে মার্ক করো
//    URL: PATCH /api/v1/notifications/:id/read
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
// ৫. PATCH /read-all/:userId — সব পড়া হিসেবে মার্ক
//    URL: PATCH /api/v1/notifications/read-all/:userId
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
// ৬. POST /send — ম্যানুয়ালি নোটিফিকেশন পাঠানো (অ্যাডমিন)
//    URL: POST /api/v1/notifications/send
//    Body: { userId, batchId?, type, title, message, link? }
// ═══════════════════════════════════════════════════════════
notificationRouter.post("/send", async (req, res, next) => {
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
});

// ═══════════════════════════════════════════════════════════
// ৭. POST /broadcast — batch বা course এর সব ছাত্রকে পাঠাও
//    URL: POST /api/v1/notifications/broadcast
//    Body: { batchId? | courseId?, type, title, message, link? }
// ═══════════════════════════════════════════════════════════
notificationRouter.post("/broadcast", async (req, res, next) => {
  try {
    const { batchId, courseId, type, title, message, link } = req.body;

    if (!type || !title || !message) {
      throw new AppError("type, title, message are required", 400);
    }

    if (!batchId && !courseId) {
      throw new AppError("Either batchId or courseId is required", 400);
    }

    // ── কার কার কাছে যাবে ──
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
});

// ═══════════════════════════════════════════════════════════
// ৮. DELETE /:id — নোটিফিকেশন ডিলিট
//    URL: DELETE /api/v1/notifications/:id
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

// ═══════════════════════════════════════════════════════════
// ৯. DELETE /clear/:userId — সব ডিলিট
//    URL: DELETE /api/v1/notifications/clear/:userId
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

export default notificationRouter;