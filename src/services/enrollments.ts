import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const enrollmentRouter = Router();

enrollmentRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// 1. POST / — Create a new enrollment (Learner)
//    Body: { learnerId, courseId, batchId? }
// ═══════════════════════════════════════════════════════════
enrollmentRouter.post("/", async (req, res, next) => {
  try {
    const { learnerId, courseId, batchId } = req.body;

    const currentUserId = req.user!.userId;
    const currentUserRole = req.user!.role;

    // Admins cannot enroll
    if (currentUserRole === "ADMIN") {
      throw new AppError(
        "Admins cannot enroll in courses. Please use a learner account.",
        403
      );
    }

    // Learner can only enroll themselves
    if (learnerId !== currentUserId) {
      throw new AppError("You can only enroll yourself", 403);
    }

    if (!learnerId || !courseId) {
      throw new AppError("learnerId and courseId are required", 400);
    }

    // Check if learner exists
    const learner = await prisma.user.findUnique({ where: { id: learnerId } });
    if (!learner || learner.isDeleted) {
      throw new AppError("Learner not found", 404);
    }

    // Check if course exists
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.isDeleted) {
      throw new AppError("Course not found", 404);
    }

    // For BATCH courses, batchId is required
    if (course.courseType === "BATCH") {
      if (!batchId) {
        throw new AppError("batchId is required for BATCH courses", 400);
      }

      const batch = await prisma.batch.findUnique({ where: { id: batchId } });
      if (!batch || batch.isDeleted) {
        throw new AppError("Batch not found", 404);
      }

      if (batch.courseId !== courseId) {
        throw new AppError("Batch does not belong to this course", 400);
      }

      if (batch.status === "COMPLETED") {
        throw new AppError("Cannot enroll in a completed batch", 400);
      }
    }

    // FIXED courses must NOT have batchId
    if (course.courseType === "FIXED" && batchId) {
      throw new AppError("FIXED courses cannot have batchId", 400);
    }

    // Prevent duplicate enrollment
    const existing = await prisma.enrollment.findFirst({
      where: {
        learnerId,
        courseId,
        batchId: batchId ?? null,
        isDeleted: false,
      },
    });

    if (existing) {
      throw new AppError("Already enrolled in this course/batch", 409);
    }

    const isFree = course.price === 0;

    // Create enrollment
    const enrollment = await prisma.enrollment.create({
      data: {
        learnerId,
        courseId,
        batchId: batchId ?? null,
        status: isFree ? "ACTIVE" : "PENDING",
      },
      include: {
        learner: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            courseType: true,
          },
        },
        batch: {
          select: {
            id: true,
            batchNumber: true,
            title: true,
            status: true,
            certificateUnlocked: true,   // 🆕 ADDED
          },
        },
      },
    });

    // For paid courses, create a pending order
    let order = null;
    if (!isFree) {
      order = await prisma.order.create({
        data: {
          learnerId,
          courseId,
          batchId: batchId ?? null,
          amount: course.price,
          status: "PENDING",
        },
      });
    }

    sendResponse({
      res,
      statusCode: 201,
      message: isFree
        ? "Enrolled successfully (Free course)"
        : "Enrollment created. Please complete the payment.",
      data: {
        enrollment,
        order,
        isFree,
        nextStep: isFree ? "Start learning" : "Complete payment",
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 2. GET /my/:learnerId — Get all enrollments for a learner
//    ⚠️ Includes certificateUnlocked for batch-based courses
// ═══════════════════════════════════════════════════════════
enrollmentRouter.get("/my/:learnerId", async (req, res, next) => {
  try {
    const learnerId = req.params.learnerId as string;

    const enrollments = await prisma.enrollment.findMany({
      where: { learnerId, isDeleted: false },
      orderBy: { enrolledAt: "desc" },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            thumbnail: true,
            courseType: true,
            price: true,
            level: true,
          },
        },
        batch: {
          select: {
            id: true,
            batchNumber: true,
            title: true,
            startDate: true,
            endDate: true,
            status: true,
            certificateUnlocked: true,   // 🆕 ADDED — CRITICAL FIX
          },
        },
      },
    });

    sendResponse({
      res,
      message: "My enrollments fetched successfully",
      data: { enrollments, total: enrollments.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. GET /course/:courseId — All enrollments for a course (ADMIN only)
// ═══════════════════════════════════════════════════════════
enrollmentRouter.get(
  "/course/:courseId",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const courseId = req.params.courseId as string;

      const enrollments = await prisma.enrollment.findMany({
        where: { courseId, isDeleted: false },
        orderBy: { enrolledAt: "desc" },
        include: {
          learner: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          batch: {
            select: {
              id: true,
              batchNumber: true,
              title: true,
              certificateUnlocked: true,   // 🆕 ADDED
            },
          },
        },
      });

      sendResponse({
        res,
        message: "Enrollments fetched successfully",
        data: { enrollments, total: enrollments.length },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 4. GET /batch/:batchId — All enrollments for a batch (ADMIN only)
// ═══════════════════════════════════════════════════════════
enrollmentRouter.get(
  "/batch/:batchId",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const batchId = req.params.batchId as string;

      const enrollments = await prisma.enrollment.findMany({
        where: { batchId, isDeleted: false },
        orderBy: { enrolledAt: "desc" },
        include: {
          learner: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          course: {
            select: { id: true, title: true, slug: true },
          },
        },
      });

      sendResponse({
        res,
        message: "Batch enrollments fetched successfully",
        data: { enrollments, total: enrollments.length },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 5. PATCH /:id/activate — Activate after successful payment (ADMIN only)
//    ⚠️ Must come BEFORE /:id route to avoid conflicts
// ═══════════════════════════════════════════════════════════
enrollmentRouter.patch(
  "/:id/activate",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;

      const exists = await prisma.enrollment.findUnique({ where: { id } });
      if (!exists || exists.isDeleted) {
        throw new AppError("Enrollment not found", 404);
      }

      // Mark related order as PAID
      if (exists.status === "PENDING") {
        await prisma.order.updateMany({
          where: {
            learnerId: exists.learnerId,
            courseId: exists.courseId,
            batchId: exists.batchId,
            status: "PENDING",
          },
          data: { status: "PAID" },
        });
      }

      // Activate enrollment
      const enrollment = await prisma.enrollment.update({
        where: { id },
        data: { status: "ACTIVE" },
      });

      sendResponse({
        res,
        message: "Enrollment activated successfully",
        data: enrollment,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 6. PATCH /:id — Update enrollment status/progress (ADMIN only)
//    Body: { status?, progress? }
// ═══════════════════════════════════════════════════════════
enrollmentRouter.patch(
  "/:id",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const { status, progress } = req.body;

      const exists = await prisma.enrollment.findUnique({ where: { id } });
      if (!exists || exists.isDeleted) {
        throw new AppError("Enrollment not found", 404);
      }

      const enrollment = await prisma.enrollment.update({
        where: { id },
        data: {
          ...(status && { status }),
          ...(progress !== undefined && { progress }),
          ...(status === "COMPLETED" && { completedAt: new Date() }),
        },
      });

      sendResponse({
        res,
        message: "Enrollment updated successfully",
        data: enrollment,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 7. DELETE /:id — Soft delete (cancel) an enrollment
// ═══════════════════════════════════════════════════════════
enrollmentRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.enrollment.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("Enrollment not found", 404);
    }

    await prisma.enrollment.update({
      where: { id },
      data: { isDeleted: true, status: "CANCELLED" },
    });

    sendResponse({ res, message: "Enrollment cancelled successfully" });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 8. GET /:id — Get a single enrollment
//    ⚠️ Must be LAST to avoid matching other routes
// ═══════════════════════════════════════════════════════════
enrollmentRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
      include: {
        learner: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        course: true,
        batch: true,   // full batch (all fields including certificateUnlocked)
      },
    });

    if (!enrollment || enrollment.isDeleted) {
      throw new AppError("Enrollment not found", 404);
    }

    sendResponse({
      res,
      message: "Enrollment fetched successfully",
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
});

export default enrollmentRouter;