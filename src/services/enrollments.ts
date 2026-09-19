import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const enrollmentRouter = Router();

// ═══════════════════════════════════════════════════════════
// ১. POST / — নতুন এনরোলমেন্ট
//    URL: POST /api/v1/enrollments
//    Body: { learnerId, courseId, batchId? }
// ═══════════════════════════════════════════════════════════
enrollmentRouter.post("/", async (req, res, next) => {
  try {
    const { learnerId, courseId, batchId } = req.body;

    if (!learnerId || !courseId) {
      throw new AppError("learnerId and courseId are required", 400);
    }

    // ── learner আছে কি? ──
    const learner = await prisma.user.findUnique({ where: { id: learnerId } });
    if (!learner || learner.isDeleted) {
      throw new AppError("Learner not found", 404);
    }

    // ── course আছে কি? ──
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.isDeleted) {
      throw new AppError("Course not found", 404);
    }

    // ── BATCH Course হলে batchId লাগবে ──
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

      // ── Batch ACTIVE বা UPCOMING হতে হবে ──
      if (batch.status === "COMPLETED") {
        throw new AppError("Cannot enroll in a completed batch", 400);
      }
    }

    // ── FIXED Course হলে batchId থাকা যাবে না ──
    if (course.courseType === "FIXED" && batchId) {
      throw new AppError("FIXED courses cannot have batchId", 400);
    }

    // ── আগে থেকে এনরোল করা কি? ──
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

    // ── Free না Paid? ──
    const isFree = course.price === 0;

    // ── এনরোলমেন্ট তৈরি ──
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
          select: { id: true, title: true, slug: true, price: true, courseType: true },
        },
        batch: {
          select: { id: true, batchNumber: true, title: true, status: true },
        },
      },
    });

    // ── Paid হলে Order তৈরি ──
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
// ২. GET /my/:learnerId — আমার সব এনরোলমেন্ট
//    URL: GET /api/v1/enrollments/my/:learnerId
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
// ৩. GET /course/:courseId — একটা কোর্সের সব এনরোলমেন্ট
//    URL: GET /api/v1/enrollments/course/:courseId
// ═══════════════════════════════════════════════════════════
enrollmentRouter.get("/course/:courseId", async (req, res, next) => {
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
          select: { id: true, batchNumber: true, title: true },
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
});

// ═══════════════════════════════════════════════════════════
// ৪. GET /batch/:batchId — একটা ব্যাচের সব এনরোলমেন্ট
//    URL: GET /api/v1/enrollments/batch/:batchId
// ═══════════════════════════════════════════════════════════
enrollmentRouter.get("/batch/:batchId", async (req, res, next) => {
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
});

// ═══════════════════════════════════════════════════════════
// ৫. GET /:id — একটা এনরোলমেন্ট দেখা
//    URL: GET /api/v1/enrollments/:id
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
        batch: true,
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

// ═══════════════════════════════════════════════════════════
// ৬. PATCH /:id — এনরোলমেন্ট আপডেট (স্ট্যাটাস, প্রোগ্রেস)
//    URL: PATCH /api/v1/enrollments/:id
//    Body: { status?, progress? }
// ═══════════════════════════════════════════════════════════
enrollmentRouter.patch("/:id", async (req, res, next) => {
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
});

// ═══════════════════════════════════════════════════════════
// ৭. PATCH /:id/activate — পেমেন্ট সফল হলে ACTIVE করা
//    URL: PATCH /api/v1/enrollments/:id/activate
// ═══════════════════════════════════════════════════════════
enrollmentRouter.patch("/:id/activate", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.enrollment.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("Enrollment not found", 404);
    }

    // ── Order PAID করো ──
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

    // ── Enrollment ACTIVE করো ──
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
});

// ═══════════════════════════════════════════════════════════
// ৮. DELETE /:id — এনরোলমেন্ট বাতিল (সফট ডিলিট)
//    URL: DELETE /api/v1/enrollments/:id
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

export default enrollmentRouter;