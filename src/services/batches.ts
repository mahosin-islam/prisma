import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const batchRouter = Router();

// ═══════════════════════════════════════════════════════════
// 1. POST / — Create a new batch (ADMIN only)
// ═══════════════════════════════════════════════════════════
batchRouter.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const { courseId, batchNumber, title, startDate, endDate, status } =
        req.body;

      if (!courseId || !batchNumber || !startDate || !endDate) {
        throw new AppError(
          "courseId, batchNumber, startDate, and endDate are required",
          400
        );
      }

      const course = await prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course || course.isDeleted) {
        throw new AppError("Course not found", 404);
      }

      if (course.courseType !== "BATCH") {
        throw new AppError(
          "Batches can only be created for BATCH courses",
          400
        );
      }

      const existing = await prisma.batch.findFirst({
        where: { courseId, batchNumber },
      });
      if (existing) {
        throw new AppError(
          `Batch ${batchNumber} already exists for this course`,
          409
        );
      }

      const batch = await prisma.batch.create({
        data: {
          courseId,
          batchNumber,
          title: title ?? `Batch ${batchNumber}`,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          status: status ?? "UPCOMING",
        },
        include: {
          course: {
            select: { id: true, title: true, slug: true },
          },
          _count: {
            select: {
              modules: true,
              enrollments: true,
              liveSessions: true,
            },
          },
        },
      });

      sendResponse({
        res,
        statusCode: 201,
        message: "Batch created successfully",
        data: batch,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 2. GET /course/:courseId — Get all batches of a course (PUBLIC)
// ═══════════════════════════════════════════════════════════
batchRouter.get("/course/:courseId", async (req, res, next) => {
  try {
    const courseId = req.params.courseId as string;

    const batches = await prisma.batch.findMany({
      where: { courseId, isDeleted: false },
      orderBy: { batchNumber: "asc" },
      include: {
        _count: {
          select: {
            modules: true,
            enrollments: true,
            liveSessions: true,
          },
        },
      },
    });

    sendResponse({
      res,
      message: "Batches fetched successfully",
      data: { batches, total: batches.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. PATCH /:id/unlock-certificate — Unlock certificate for batch (ADMIN only)
//    ⚠️ MUST come BEFORE PATCH /:id to avoid conflicts
//    Sets certificateUnlocked = true. Learners can only generate
//    certificates after this.
// ═══════════════════════════════════════════════════════════
batchRouter.patch(
  "/:id/unlock-certificate",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;

      const batch = await prisma.batch.findUnique({
        where: { id },
        include: {
          course: { select: { id: true, title: true } },
        },
      });

      if (!batch || batch.isDeleted) {
        throw new AppError("Batch not found", 404);
      }

      if (batch.certificateUnlocked) {
        return sendResponse({
          res,
          message: "Certificate is already unlocked for this batch",
          data: batch,
        });
      }

      const updated = await prisma.batch.update({
        where: { id },
        data: { certificateUnlocked: true },
      });

      // Notify enrolled learners
      const enrollments = await prisma.enrollment.findMany({
        where: {
          batchId: id,
          status: { in: ["ACTIVE", "COMPLETED"] },
          isDeleted: false,
        },
        select: { learnerId: true },
      });

      if (enrollments.length > 0) {
        await prisma.notification.createMany({
          data: enrollments.map((e) => ({
            userId: e.learnerId,
            batchId: id,
            type: "COURSE_COMPLETED",
            title: "🎓 Certificate Available",
            message: `Your certificate for ${batch.course.title} is now available!`,
            link: "/learner/certificates",
          })),
        });
      }

      sendResponse({
        res,
        message: `Certificate unlocked for Batch ${batch.batchNumber}. ${enrollments.length} learners notified.`,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 4. GET /:id — Get a single batch (PUBLIC)
// ═══════════════════════════════════════════════════════════
batchRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            courseType: true,
          },
        },
        modules: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
          include: {
            lessons: {
              where: { isDeleted: false },
              orderBy: { order: "asc" },
              select: {
                id: true,
                title: true,
                type: true,
                videoId: true,
                videoUrl: true,
                duration: true,
                thumbnail: true,
                isFree: true,
                isPublished: true,
                availableAt: true,
                order: true,
              },
            },
            assignments: {
              where: { isDeleted: false },
              select: {
                id: true,
                title: true,
                deadline: true,
                totalMarks: true,
              },
            },
          },
        },
        liveSessions: {
          where: { isDeleted: false },
          orderBy: { scheduledAt: "desc" },
        },
        _count: {
          select: {
            enrollments: true,
            modules: true,
          },
        },
      },
    });

    if (!batch || batch.isDeleted) {
      throw new AppError("Batch not found", 404);
    }

    sendResponse({
      res,
      message: "Batch fetched successfully",
      data: batch,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 5. PATCH /:id — Update a batch (ADMIN only)
// ═══════════════════════════════════════════════════════════
batchRouter.patch(
  "/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const { title, startDate, endDate, status } = req.body;

      const exists = await prisma.batch.findUnique({ where: { id } });
      if (!exists || exists.isDeleted) {
        throw new AppError("Batch not found", 404);
      }

      const batch = await prisma.batch.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(startDate && { startDate: new Date(startDate) }),
          ...(endDate && { endDate: new Date(endDate) }),
          ...(status && { status }),
        },
        include: {
          course: {
            select: { id: true, title: true, slug: true },
          },
        },
      });

      sendResponse({
        res,
        message: "Batch updated successfully",
        data: batch,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 6. PATCH /:id/activate — Activate batch (ADMIN only)
// ═══════════════════════════════════════════════════════════
batchRouter.patch(
  "/:id/activate",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;

      const exists = await prisma.batch.findUnique({ where: { id } });
      if (!exists || exists.isDeleted) {
        throw new AppError("Batch not found", 404);
      }

      await prisma.batch.updateMany({
        where: {
          courseId: exists.courseId,
          status: "ACTIVE",
          id: { not: id },
        },
        data: { status: "COMPLETED" },
      });

      const batch = await prisma.batch.update({
        where: { id },
        data: { status: "ACTIVE" },
      });

      sendResponse({
        res,
        message: `Batch ${batch.batchNumber} is now ACTIVE`,
        data: batch,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 7. DELETE /:id — Soft delete a batch (ADMIN only)
// ═══════════════════════════════════════════════════════════
batchRouter.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;

      const exists = await prisma.batch.findUnique({ where: { id } });
      if (!exists || exists.isDeleted) {
        throw new AppError("Batch not found", 404);
      }

      const enrollmentCount = await prisma.enrollment.count({
        where: { batchId: id, isDeleted: false },
      });

      if (enrollmentCount > 0) {
        throw new AppError(
          `Cannot delete batch with ${enrollmentCount} enrolled students`,
          400
        );
      }

      await prisma.batch.update({
        where: { id },
        data: { isDeleted: true },
      });

      sendResponse({ res, message: "Batch deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
);

export default batchRouter;