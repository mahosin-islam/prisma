import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const liveSessionRouter = Router();

liveSessionRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// Helper: Check if learner is enrolled in a batch
// ═══════════════════════════════════════════════════════════
async function verifyBatchEnrollment(learnerId: string, batchId: string) {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      learnerId,
      batchId,
      status: { in: ["ACTIVE", "COMPLETED"] },
      isDeleted: false,
    },
  });

  if (!enrollment) {
    throw new AppError("You are not enrolled in this batch", 403);
  }

  return enrollment;
}

// ═══════════════════════════════════════════════════════════
// 1. POST / — Create a new live session (ADMIN only)
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

      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { course: true },
      });

      if (!batch || batch.isDeleted) {
        throw new AppError("Batch not found", 404);
      }

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

      // Send notifications — include both ACTIVE and COMPLETED enrollments
      if (notifyStudents) {
        const enrollments = await prisma.enrollment.findMany({
          where: {
            batchId,
            status: { in: ["ACTIVE", "COMPLETED"] },   // ✅ FIXED
            isDeleted: false,
          },
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
              link: `/learner/live-sessions`,
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
// 2. GET /my/:learnerId — Get all live sessions for a learner
//    ⚠️ Must be BEFORE /:id route
//    ⚠️ Self/Admin check
// ═══════════════════════════════════════════════════════════
liveSessionRouter.get("/my/:learnerId", async (req, res, next) => {
  try {
    const learnerId = req.params.learnerId as string;

    // Only self or ADMIN
    if (req.user!.userId !== learnerId && req.user!.role !== "ADMIN") {
      throw new AppError("You can only view your own sessions", 403);
    }

    const enrollments = await prisma.enrollment.findMany({
      where: {
        learnerId,
        status: { in: ["ACTIVE", "COMPLETED"] },   // ✅ FIXED
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
// 3. GET /batch/:batchId — Get all live sessions of a batch
//    ⚠️ Must be BEFORE /:id route
//    ⚠️ Learner must be enrolled OR admin
// ═══════════════════════════════════════════════════════════
liveSessionRouter.get("/batch/:batchId", async (req, res, next) => {
  try {
    const batchId = req.params.batchId as string;
    const upcoming = req.query.upcoming === "true";

    // Verify enrollment (unless admin)
    if (req.user!.role !== "ADMIN") {
      await verifyBatchEnrollment(req.user!.userId, batchId);
    }

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
// 4. PATCH /:id — Update a live session (ADMIN only)
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
// 5. DELETE /:id — Soft delete a live session (ADMIN only)
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

// ═══════════════════════════════════════════════════════════
// 6. GET /:id — Get a single live session
//    ⚠️ Must be LAST
//    ⚠️ Learner must be enrolled in the batch OR admin
//    ⚠️ Meeting link only revealed when LIVE
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

    // Verify enrollment for learners
    if (req.user!.role !== "ADMIN") {
      await verifyBatchEnrollment(req.user!.userId, session.batchId);
    }

    // Compute status
    const now = new Date();
    const sessionEnd = new Date(
      session.scheduledAt.getTime() + session.duration * 60 * 1000
    );

    const isLive = now >= session.scheduledAt && now <= sessionEnd;
    const isUpcoming = now < session.scheduledAt;

    // Only reveal meeting link when LIVE (or for admin)
    const isAdmin = req.user!.role === "ADMIN";
    const shouldRevealLink = isLive || isAdmin;

    sendResponse({
      res,
      message: "Live session fetched successfully",
      data: {
        ...session,
        meetingLink: shouldRevealLink ? session.meetingLink : null,
        status: isLive ? "LIVE" : isUpcoming ? "UPCOMING" : "ENDED",
      },
    });
  } catch (error) {
    next(error);
  }
});

export default liveSessionRouter;