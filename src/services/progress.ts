import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const progressRouter = Router();

// ═══════════════════════════════════════════════════════════
// ১. POST /complete — লেসন সম্পন্ন করা
//    URL: POST /api/v1/progress/complete
//    Body: { learnerId, lessonId }
// ═══════════════════════════════════════════════════════════
progressRouter.post("/complete", async (req, res, next) => {
  try {
    const { learnerId, lessonId } = req.body;

    if (!learnerId || !lessonId) {
      throw new AppError("learnerId and lessonId are required", 400);
    }

    // ── Lesson আছে কি? ──
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            course: true,
          },
        },
      },
    });

    if (!lesson || lesson.isDeleted) {
      throw new AppError("Lesson not found", 404);
    }

    // ── ছাত্র এনরোল করা আছে কি? ──
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        learnerId,
        courseId: lesson.module.courseId,
        ...(lesson.module.batchId && { batchId: lesson.module.batchId }),
        status: "ACTIVE",
        isDeleted: false,
      },
    });

    if (!enrollment) {
      throw new AppError("You are not enrolled in this course", 403);
    }

    // ── Progress আপডেট ──
    const progress = await prisma.lessonProgress.upsert({
      where: {
        learnerId_lessonId: { learnerId, lessonId },
      },
      update: {
        isCompleted: true,
        isUnlocked: true,
        completedAt: new Date(),
      },
      create: {
        learnerId,
        lessonId,
        isCompleted: true,
        isUnlocked: true,
        completedAt: new Date(),
      },
    });

    // ── পরের লেসন আনলক করো ──
    const nextLesson = await prisma.lesson.findFirst({
      where: {
        moduleId: lesson.moduleId,
        order: { gt: lesson.order },
        isDeleted: false,
      },
      orderBy: { order: "asc" },
    });

    if (nextLesson) {
      await prisma.lessonProgress.upsert({
        where: {
          learnerId_lessonId: { learnerId, lessonId: nextLesson.id },
        },
        update: { isUnlocked: true },
        create: {
          learnerId,
          lessonId: nextLesson.id,
          isUnlocked: true,
          isCompleted: false,
        },
      });
    }

    // ── Enrollment progress (%) আপডেট ──
    const updatedEnrollment = await recalculateProgress(
      enrollment.id,
      lesson.module.courseId,
      lesson.module.batchId,
      learnerId
    );

    sendResponse({
      res,
      message: "Lesson marked as completed",
      data: {
        progress,
        nextLessonUnlocked: nextLesson
          ? { id: nextLesson.id, title: nextLesson.title }
          : null,
        enrollmentProgress: updatedEnrollment.progress,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// Helper: enrollment progress % হিসাব করে
// ═══════════════════════════════════════════════════════════
async function recalculateProgress(
  enrollmentId: string,
  courseId: string,
  batchId: string | null,
  learnerId: string
) {
  // ── সব lesson এর ID ──
  const modules = await prisma.module.findMany({
    where: {
      courseId,
      isDeleted: false,
      ...(batchId !== null ? { batchId } : { batchId: null }),
    },
    include: {
      lessons: {
        where: { isDeleted: false, isPublished: true },
        select: { id: true },
      },
    },
  });

  const lessonIds = modules.flatMap((m) => m.lessons.map((l) => l.id));
  const totalLessons = lessonIds.length;

  if (totalLessons === 0) {
    return prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { progress: 0 },
    });
  }

  // ── কতগুলো সম্পন্ন ──
  const completedCount = await prisma.lessonProgress.count({
    where: {
      learnerId,
      lessonId: { in: lessonIds },
      isCompleted: true,
    },
  });

  const percentage = Math.round((completedCount / totalLessons) * 100);

  // ── Update enrollment ──
  return prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      progress: percentage,
      ...(percentage === 100 && { status: "COMPLETED", completedAt: new Date() }),
    },
  });
}

// ═══════════════════════════════════════════════════════════
// ২. GET /my/:learnerId/course/:courseId
//    URL: GET /api/v1/progress/my/:learnerId/course/:courseId
// ═══════════════════════════════════════════════════════════
progressRouter.get(
  "/my/:learnerId/course/:courseId",
  async (req, res, next) => {
    try {
      const learnerId = req.params.learnerId as string;
      const courseId = req.params.courseId as string;
      const batchId = req.query.batchId as string | undefined;

      // ── সব lesson + progress ──
      const modules = await prisma.module.findMany({
        where: {
          courseId,
          isDeleted: false,
          ...(batchId !== undefined ? { batchId } : { batchId: null }),
        },
        orderBy: { order: "asc" },
        include: {
          lessons: {
            where: { isDeleted: false },
            orderBy: { order: "asc" },
            include: {
              lessonProgress: {
                where: { learnerId },
              },
            },
          },
        },
      });

      const result = modules.map((m) => ({
        id: m.id,
        title: m.title,
        order: m.order,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          type: l.type,
          order: l.order,
          isPublished: l.isPublished,
          availableAt: l.availableAt,
          progress: l.lessonProgress[0] || {
            isCompleted: false,
            isUnlocked: false,
          },
        })),
      }));

      sendResponse({
        res,
        message: "Progress fetched successfully",
        data: { modules: result },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// ৩. GET /lesson/:lessonId/check — লেসন লক/আনলক চেক
//    URL: GET /api/v1/progress/lesson/:lessonId/check?learnerId=xxx
// ═══════════════════════════════════════════════════════════
progressRouter.get("/lesson/:lessonId/check", async (req, res, next) => {
  try {
    const lessonId = req.params.lessonId as string;
    const learnerId = req.query.learnerId as string;

    if (!learnerId) {
      throw new AppError("learnerId query is required", 400);
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { module: true },
    });

    if (!lesson || lesson.isDeleted) {
      throw new AppError("Lesson not found", 404);
    }

    // ── এনরোলমেন্ট আছে কি? ──
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        learnerId,
        courseId: lesson.module.courseId,
        ...(lesson.module.batchId && { batchId: lesson.module.batchId }),
        status: "ACTIVE",
        isDeleted: false,
      },
    });

    if (!enrollment) {
      throw new AppError("You are not enrolled in this course", 403);
    }

    // ── আগের লেসন শেষ করেছে কি? ──
    const previousLesson = await prisma.lesson.findFirst({
      where: {
        moduleId: lesson.moduleId,
        order: { lt: lesson.order },
        isDeleted: false,
      },
      orderBy: { order: "desc" },
    });

    let isUnlocked = true;

    if (previousLesson) {
      const prevProgress = await prisma.lessonProgress.findUnique({
        where: {
          learnerId_lessonId: { learnerId, lessonId: previousLesson.id },
        },
      });
      isUnlocked = prevProgress?.isCompleted ?? false;
    }

    // ── Batch হলে availableAt চেক ──
    let dateUnlocked = true;
    if (lesson.availableAt) {
      dateUnlocked = new Date() >= lesson.availableAt;
    }

    const canAccess = isUnlocked && dateUnlocked;

    sendResponse({
      res,
      message: canAccess ? "Lesson is accessible" : "Lesson is locked",
      data: {
        canAccess,
        isUnlocked,
        dateUnlocked,
        previousLesson: previousLesson
          ? { id: previousLesson.id, title: previousLesson.title }
          : null,
        availableAt: lesson.availableAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৪. POST /unlock-first — নতুন এনরোলমেন্টে প্রথম লেসন আনলক
//    URL: POST /api/v1/progress/unlock-first
//    Body: { learnerId, courseId, batchId? }
// ═══════════════════════════════════════════════════════════
progressRouter.post("/unlock-first", async (req, res, next) => {
  try {
    const { learnerId, courseId, batchId } = req.body;

    if (!learnerId || !courseId) {
      throw new AppError("learnerId and courseId are required", 400);
    }

    // ── প্রথম module ──
    const firstModule = await prisma.module.findFirst({
      where: {
        courseId,
        isDeleted: false,
        ...(batchId ? { batchId } : { batchId: null }),
      },
      orderBy: { order: "asc" },
      include: {
        lessons: {
          where: { isDeleted: false, isPublished: true },
          orderBy: { order: "asc" },
          take: 1,
        },
      },
    });

    if (!firstModule || firstModule.lessons.length === 0) {
      throw new AppError("No lessons available in this course", 404);
    }

    const firstLesson = firstModule.lessons[0]!;

    const progress = await prisma.lessonProgress.upsert({
      where: {
        learnerId_lessonId: { learnerId, lessonId: firstLesson.id },
      },
      update: { isUnlocked: true },
      create: {
        learnerId,
        lessonId: firstLesson.id,
        isUnlocked: true,
      },
    });

    sendResponse({
      res,
      message: "First lesson unlocked",
      data: progress,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৫. DELETE /reset — ছাত্রের প্রোগ্রেস রিসেট (অ্যাডমিন)
//    URL: DELETE /api/v1/progress/reset?learnerId=xxx&courseId=yyy
// ═══════════════════════════════════════════════════════════
progressRouter.delete("/reset", async (req, res, next) => {
  try {
    const learnerId = req.query.learnerId as string;
    const courseId = req.query.courseId as string;

    if (!learnerId || !courseId) {
      throw new AppError("learnerId and courseId query are required", 400);
    }

    const modules = await prisma.module.findMany({
      where: { courseId, isDeleted: false },
      include: {
        lessons: { where: { isDeleted: false }, select: { id: true } },
      },
    });

    const lessonIds = modules.flatMap((m) => m.lessons.map((l) => l.id));

    await prisma.lessonProgress.deleteMany({
      where: {
        learnerId,
        lessonId: { in: lessonIds },
      },
    });

    await prisma.enrollment.updateMany({
      where: { learnerId, courseId },
      data: { progress: 0, status: "ACTIVE", completedAt: null },
    });

    sendResponse({ res, message: "Progress reset successfully" });
  } catch (error) {
    next(error);
  }
});

export default progressRouter;