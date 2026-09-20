import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const progressRouter = Router();

progressRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// Helper: Recalculate enrollment progress percentage
// ═══════════════════════════════════════════════════════════
async function recalculateProgress(
  enrollmentId: string,
  courseId: string,
  batchId: string | null,
  learnerId: string
) {
  // Get all lessons in the course/batch
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

  // Count completed lessons
  const completedCount = await prisma.lessonProgress.count({
    where: {
      learnerId,
      lessonId: { in: lessonIds },
      isCompleted: true,
    },
  });

  const percentage = Math.round((completedCount / totalLessons) * 100);

  // Update enrollment
  return prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      progress: percentage,
      ...(percentage === 100 && {
        status: "COMPLETED",
        completedAt: new Date(),
      }),
    },
  });
}

// ═══════════════════════════════════════════════════════════
// 1. POST /complete — Mark a lesson as completed
//    Body: { learnerId, lessonId }
// ═══════════════════════════════════════════════════════════
progressRouter.post("/complete", async (req, res, next) => {
  try {
    const { learnerId, lessonId } = req.body;

    if (!learnerId || !lessonId) {
      throw new AppError("learnerId and lessonId are required", 400);
    }

    // Check if lesson exists
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: true } } },
    });

    if (!lesson || lesson.isDeleted) {
      throw new AppError("Lesson not found", 404);
    }

    // Check if learner is enrolled (allow ACTIVE or COMPLETED)
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        learnerId,
        courseId: lesson.module.courseId,
        ...(lesson.module.batchId && { batchId: lesson.module.batchId }),
        status: { in: ["ACTIVE", "COMPLETED"] },
        isDeleted: false,
      },
    });

    if (!enrollment) {
      throw new AppError("You are not enrolled in this course", 403);
    }

    // Update lesson progress
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

    // ── Unlock the next lesson ──
    // Step 1: Try to find next lesson in the SAME module
    let nextLesson = await prisma.lesson.findFirst({
      where: {
        moduleId: lesson.moduleId,
        order: { gt: lesson.order },
        isDeleted: false,
      },
      orderBy: { order: "asc" },
    });

    // Step 2: If no next lesson in same module → find first lesson
    // of the NEXT module (same course + batch)
    if (!nextLesson) {
      const nextModule = await prisma.module.findFirst({
        where: {
          courseId: lesson.module.courseId,
          batchId: lesson.module.batchId,
          order: { gt: lesson.module.order },
          isDeleted: false,
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

      if (nextModule && nextModule.lessons.length > 0) {
        nextLesson = nextModule.lessons[0]!;
      }
    }

    // Step 3: Unlock the found lesson
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

    // Recalculate enrollment progress
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
// 2. GET /my/:learnerId/course/:courseId
//    Get learner's progress for a specific course
// ═══════════════════════════════════════════════════════════
progressRouter.get(
  "/my/:learnerId/course/:courseId",
  async (req, res, next) => {
    try {
      const learnerId = req.params.learnerId as string;
      const courseId = req.params.courseId as string;
      const batchId = req.query.batchId as string | undefined;

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
              lessonProgress: { where: { learnerId } },
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
// 3. GET /lesson/:lessonId/check — Check if lesson is locked
//    Query: ?learnerId=xxx
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

    // Check enrollment
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        learnerId,
        courseId: lesson.module.courseId,
        ...(lesson.module.batchId && { batchId: lesson.module.batchId }),
        status: { in: ["ACTIVE", "COMPLETED"] },
        isDeleted: false,
      },
    });

    if (!enrollment) {
      throw new AppError("You are not enrolled in this course", 403);
    }

    // Check if previous lesson is completed
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

    // For BATCH courses, check availableAt date
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
// 4. POST /unlock-first — Unlock the first lesson after enrollment
//    Body: { learnerId, courseId, batchId? }
// ═══════════════════════════════════════════════════════════
progressRouter.post("/unlock-first", async (req, res, next) => {
  try {
    const { learnerId, courseId, batchId } = req.body;

    if (!learnerId || !courseId) {
      throw new AppError("learnerId and courseId are required", 400);
    }

    const firstModule = await prisma.module.findFirst({
      where: {
        courseId,
        isDeleted: false,
        ...(batchId !== undefined
          ? { batchId: batchId || null }
          : { batchId: null }),
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
// 5. DELETE /reset — Reset learner progress (ADMIN only)
//    Query: ?learnerId=xxx&courseId=yyy
// ═══════════════════════════════════════════════════════════
progressRouter.delete(
  "/reset",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
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
        where: { learnerId, lessonId: { in: lessonIds } },
      });

      await prisma.enrollment.updateMany({
        where: { learnerId, courseId },
        data: { progress: 0, status: "ACTIVE", completedAt: null },
      });

      sendResponse({ res, message: "Progress reset successfully" });
    } catch (error) {
      next(error);
    }
  }
);

export default progressRouter;