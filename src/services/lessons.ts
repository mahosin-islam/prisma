import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const lessonRouter = Router();

// ═══════════════════════════════════════════════════════════
// ১. POST / — নতুন লেসন তৈরি
//    URL: POST /api/v1/lessons
//    Body: { moduleId, title, description?, type, content?,
//            videoId?, videoUrl?, provider?, duration?,
//            thumbnail?, order, isFree?, isPublished?,
//            availableAt?, notifyStudents? }
// ═══════════════════════════════════════════════════════════
lessonRouter.post("/", async (req, res, next) => {
  try {
    const {
      moduleId,
      title,
      description,
      type,
      content,
      videoId,
      videoUrl,
      provider,
      duration,
      thumbnail,
      order,
      isFree,
      isPublished,
      availableAt,
      notifyStudents,
    } = req.body;

    if (!moduleId || !title || !type || order === undefined) {
      throw new AppError(
        "moduleId, title, type, and order are required",
        400
      );
    }

    // ── মডিউল আছে কি? ──
    const moduleData = await prisma.module.findUnique({
      where: { id: moduleId },
    });
    if (!moduleData || moduleData.isDeleted) {
      throw new AppError("Module not found", 404);
    }

    // ── লেসন তৈরি ──
    const lesson = await prisma.lesson.create({
      data: {
        moduleId,
        title,
        description: description ?? null,
        type,
        content: content ?? null,
        videoId: videoId ?? null,
        videoUrl: videoUrl ?? null,
        provider: provider ?? "youtube",
        duration: duration ?? null,
        thumbnail: thumbnail ?? null,
        order,
        isFree: isFree ?? false,
        isPublished: isPublished ?? false,
        availableAt: availableAt ? new Date(availableAt) : null,
      },
    });

    // ── নোটিফিকেশন পাঠানো (ঐচ্ছিক) ──
    if (notifyStudents && moduleData.batchId) {
      const enrollments = await prisma.enrollment.findMany({
        where: {
          batchId: moduleData.batchId,
          status: "ACTIVE",
          isDeleted: false,
        },
        select: { learnerId: true },
      });

      if (enrollments.length > 0) {
        await prisma.notification.createMany({
          data: enrollments.map((e) => ({
            userId: e.learnerId,
            batchId: moduleData.batchId,
            type: "NEW_LESSON",
            title: "নতুন লেসন যোগ হয়েছে",
            message: lesson.title,
            link: `/lessons/${lesson.id}`,
          })),
        });
      }
    }

    // ── FIXED course হলে সব এনরোল করা ছাত্রকে জানাও ──
    if (notifyStudents && !moduleData.batchId) {
      const enrollments = await prisma.enrollment.findMany({
        where: {
          courseId: moduleData.courseId,
          status: "ACTIVE",
          isDeleted: false,
        },
        select: { learnerId: true },
      });

      if (enrollments.length > 0) {
        await prisma.notification.createMany({
          data: enrollments.map((e) => ({
            userId: e.learnerId,
            type: "NEW_LESSON",
            title: "নতুন লেসন যোগ হয়েছে",
            message: lesson.title,
            link: `/lessons/${lesson.id}`,
          })),
        });
      }
    }

    sendResponse({
      res,
      statusCode: 201,
      message: notifyStudents
        ? "Lesson created and students notified"
        : "Lesson created successfully",
      data: lesson,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ২. GET /module/:moduleId — একটা মডিউলের সব লেসন
//    URL: GET /api/v1/lessons/module/:moduleId
// ═══════════════════════════════════════════════════════════
lessonRouter.get("/module/:moduleId", async (req, res, next) => {
  try {
    const moduleId = req.params.moduleId as string;

    const lessons = await prisma.lesson.findMany({
      where: { moduleId, isDeleted: false },
      orderBy: { order: "asc" },
      include: {
        _count: {
          select: { quizzes: true },
        },
      },
    });

    sendResponse({
      res,
      message: "Lessons fetched successfully",
      data: { lessons, total: lessons.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৩. GET /:id — একটা লেসন দেখা (quiz সহ)
//    URL: GET /api/v1/lessons/:id
// ═══════════════════════════════════════════════════════════
lessonRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        module: {
          select: {
            id: true,
            title: true,
            courseId: true,
            batchId: true,
          },
        },
        quizzes: {
          orderBy: { order: "asc" },
        },
      },
    });

    if (!lesson || lesson.isDeleted) {
      throw new AppError("Lesson not found", 404);
    }

    sendResponse({
      res,
      message: "Lesson fetched successfully",
      data: lesson,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৪. PATCH /:id — লেসন আপডেট
//    URL: PATCH /api/v1/lessons/:id
// ═══════════════════════════════════════════════════════════
lessonRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const {
      title,
      description,
      type,
      content,
      videoId,
      videoUrl,
      provider,
      duration,
      thumbnail,
      order,
      isFree,
      isPublished,
      availableAt,
    } = req.body;

    const exists = await prisma.lesson.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("Lesson not found", 404);
    }

    const updated = await prisma.lesson.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(type && { type }),
        ...(content !== undefined && { content }),
        ...(videoId !== undefined && { videoId }),
        ...(videoUrl !== undefined && { videoUrl }),
        ...(provider !== undefined && { provider }),
        ...(duration !== undefined && { duration }),
        ...(thumbnail !== undefined && { thumbnail }),
        ...(order !== undefined && { order }),
        ...(isFree !== undefined && { isFree }),
        ...(isPublished !== undefined && { isPublished }),
        ...(availableAt !== undefined && {
          availableAt: availableAt ? new Date(availableAt) : null,
        }),
      },
    });

    sendResponse({
      res,
      message: "Lesson updated successfully",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৫. DELETE /:id — সফট ডিলিট
//    URL: DELETE /api/v1/lessons/:id
// ═══════════════════════════════════════════════════════════
lessonRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.lesson.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("Lesson not found", 404);
    }

    await prisma.lesson.update({
      where: { id },
      data: { isDeleted: true },
    });

    sendResponse({ res, message: "Lesson deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default lessonRouter;