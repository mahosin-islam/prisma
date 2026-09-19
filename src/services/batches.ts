import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const batchRouter = Router();

// ═══════════════════════════════════════════════════════════
// ১. POST / — নতুন ব্যাচ তৈরি (শুধু ADMIN)
//    URL: POST /api/v1/batches
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
// ২. GET /course/:courseId — কোর্সের সব ব্যাচ (পাবলিক)
//    URL: GET /api/v1/batches/course/:courseId
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
// ৩. GET /:id — একটা ব্যাচ (পাবলিক)
//    URL: GET /api/v1/batches/:id
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
// ৪. PATCH /:id — ব্যাচ আপডেট (শুধু ADMIN)
//    URL: PATCH /api/v1/batches/:id
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
// ৫. PATCH /:id/activate — ব্যাচ সক্রিয় (শুধু ADMIN)
//    URL: PATCH /api/v1/batches/:id/activate
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
// ৬. DELETE /:id — সফট ডিলিট (শুধু ADMIN)
//    URL: DELETE /api/v1/batches/:id
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