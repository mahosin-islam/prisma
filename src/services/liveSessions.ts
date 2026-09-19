import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const liveSessionRouter = Router();

liveSessionRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// 1. POST / — Create a new live session (ADMIN only)
//    Body: { batchId, title, description?, meetingLink,
//            scheduledAt, duration?, notifyStudents? }
// ═══════════════════════════════════════════════════════════
liveSessionRouter.post(
  "/",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const {
        batchId,
        title,
        description,
        meetingLink,
        scheduledAt,
        duration,
        notifyStudents,
      } = req.body;

      if (!batchId || !title || !meetingLink || !scheduledAt) {
        throw new AppError(
          "batchId, title, meetingLink, scheduledAt are required",
          400
        );
      }

      // Check if batch exists
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { course: true },
      });

      if (!batch || batch.isDeleted) {
        throw new AppError("Batch not found", 404);
      }

      // Create live session
      const session = await prisma.liveSession.create({
        data: {
          batchId,
          title,
          description: description ?? null,
          meetingLink,
          scheduledAt: new Date(scheduledAt),
          duration: duration ?? 60,
        },
        include: {
          batch: {
            select: { id: true, batchNumber: true, title: true },
          },
        },
      });

      // Send notifications to enrolled students
      if (notifyStudents) {
        const enrollments = await prisma.enrollment.findMany({
          where: { batchId, status: "ACTIVE", isDeleted: false },
          select: { learnerId: true },
        });

        if (enrollments.length > 0) {
          await prisma.notification.createMany({
            data: enrollments.map((e) => ({
              userId: e.learnerId,
              batchId,
              type: "NEW_LIVE_CLASS",
              title: "New Live Class",
              message: `${title} — ${new Date(scheduledAt).toLocaleString()}`,
              link: `/live-sessions/${session.id}`,
            })),
          });
        }
      }

      sendResponse({
        res,
        statusCode: 201,
        message: notifyStudents
          ? "Live session created and students notified"
          : "Live session created successfully",
        data: session,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 2. GET /batch/:batchId — Get all live sessions of a batch
//    Query: ?upcoming=true (only future sessions)
// ═══════════════════════════════════════════════════════════
liveSessionRouter.get("/batch/:batchId", async (req, res, next) => {
  try {
    const batchId = req.params.batchId as string;
    const upcoming = req.query.upcoming === "true";

    const sessions = await prisma.liveSession.findMany({
      where: {
        batchId,
        isDeleted: false,
        ...(upcoming && { scheduledAt: { gte: new Date() } }),
      },
      orderBy: { scheduledAt: upcoming ? "asc" : "desc" },
    });

    sendResponse({
      res,
      message: "Live sessions fetched successfully",
      data: { sessions, total: sessions.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. GET /my/:learnerId — Get all live sessions for a learner
// ═══════════════════════════════════════════════════════════
liveSessionRouter.get("/my/:learnerId", async (req, res, next) => {
  try {
    const learnerId = req.params.learnerId as string;

    const enrollments = await prisma.enrollment.findMany({
      where: {
        learnerId,
        status: "ACTIVE",
        isDeleted: false,
        batchId: { not: null },
      },
      select: { batchId: true },
    });

    const batchIds = enrollments
      .map((e) => e.batchId)
      .filter((b): b is string => b !== null);

    const sessions = await prisma.liveSession.findMany({
      where: { batchId: { in: batchIds }, isDeleted: false },
      orderBy: { scheduledAt: "asc" },
      include: {
        batch: {
          select: { id: true, batchNumber: true, title: true },
        },
      },
    });

    const now = new Date();
    const upcoming = sessions.filter((s) => s.scheduledAt >= now);
    const past = sessions.filter((s) => s.scheduledAt < now);

    sendResponse({
      res,
      message: "My live sessions fetched successfully",
      data: { upcoming, past },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 4. GET /:id — Get a single live session
// ═══════════════════════════════════════════════════════════
liveSessionRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const session = await prisma.liveSession.findUnique({
      where: { id },
      include: {
        batch: {
          select: {
            id: true,
            batchNumber: true,
            title: true,
            course: { select: { id: true, title: true, slug: true } },
          },
        },
      },
    });

    if (!session || session.isDeleted) {
      throw new AppError("Live session not found", 404);
    }

    // Compute session status based on schedule
    const now = new Date();
    const sessionEnd = new Date(
      session.scheduledAt.getTime() + session.duration * 60 * 1000
    );

    const isLive = now >= session.scheduledAt && now <= sessionEnd;
    const isUpcoming = now < session.scheduledAt;

    sendResponse({
      res,
      message: "Live session fetched successfully",
      data: {
        ...session,
        status: isLive ? "LIVE" : isUpcoming ? "UPCOMING" : "ENDED",
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 5. PATCH /:id — Update a live session (ADMIN only)
// ═══════════════════════════════════════════════════════════
liveSessionRouter.patch(
  "/:id",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const { title, description, meetingLink, scheduledAt, duration } =
        req.body;

      const exists = await prisma.liveSession.findUnique({ where: { id } });
      if (!exists || exists.isDeleted) {
        throw new AppError("Live session not found", 404);
      }

      const session = await prisma.liveSession.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(description !== undefined && { description }),
          ...(meetingLink && { meetingLink }),
          ...(scheduledAt && { scheduledAt: new Date(scheduledAt) }),
          ...(duration !== undefined && { duration }),
        },
        include: {
          batch: { select: { id: true, batchNumber: true, title: true } },
        },
      });

      sendResponse({
        res,
        message: "Live session updated successfully",
        data: session,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 6. DELETE /:id — Soft delete a live session (ADMIN only)
// ═══════════════════════════════════════════════════════════
liveSessionRouter.delete(
  "/:id",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;

      const exists = await prisma.liveSession.findUnique({ where: { id } });
      if (!exists || exists.isDeleted) {
        throw new AppError("Live session not found", 404);
      }

      await prisma.liveSession.update({
        where: { id },
        data: { isDeleted: true },
      });

      sendResponse({ res, message: "Live session deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
);

export default liveSessionRouter;