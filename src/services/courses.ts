import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const courseRouter = Router();

// ═══════════════════════════════════════════════════════════
// 1. POST / — Create a new course (ADMIN only)
// ═══════════════════════════════════════════════════════════
courseRouter.post(
  "/",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const {
        title,
        slug,
        description,
        courseType,
        thumbnail,
        price,
        level,
        status,
        adminId,
      } = req.body;

      if (!title || !slug || !description || !adminId) {
        throw new AppError(
          "title, slug, description, and adminId are required",
          400
        );
      }

      if (courseType && !["FIXED", "BATCH"].includes(courseType)) {
        throw new AppError("courseType must be FIXED or BATCH", 400);
      }

      const existing = await prisma.course.findUnique({ where: { slug } });
      if (existing) {
        throw new AppError("Course with this slug already exists", 409);
      }

      const admin = await prisma.user.findUnique({ where: { id: adminId } });
      if (!admin || admin.isDeleted) {
        throw new AppError("Admin user not found", 404);
      }

      const course = await prisma.course.create({
        data: {
          title,
          slug,
          description,
          courseType: courseType ?? "FIXED",
          thumbnail: thumbnail ?? null,
          price: price ?? 0,
          level: level ?? "BEGINNER",
          status: status ?? "DRAFT",
          adminId,
        },
        include: {
          admin: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          _count: {
            select: { modules: true, enrollments: true, batches: true },
          },
        },
      });

      sendResponse({
        res,
        statusCode: 201,
        message: "Course created successfully",
        data: course,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 2. GET / — Get all courses (PUBLIC)
// ═══════════════════════════════════════════════════════════
courseRouter.get("/", async (req, res, next) => {
  try {
    const search = req.query.search as string | undefined;
    const level = req.query.level as string | undefined;
    const status = req.query.status as string | undefined;
    const courseType = req.query.courseType as string | undefined;

    const where = {
      isDeleted: false,
      ...(search && {
        OR: [
          { title: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
        ],
      }),
      ...(level && { level: level as "BEGINNER" | "INTERMEDIATE" | "ADVANCED" }),
      ...(status && { status: status as "DRAFT" | "PUBLISHED" | "ARCHIVED" }),
      ...(courseType && { courseType: courseType as "FIXED" | "BATCH" }),
    };

    const courses = await prisma.course.findMany({
      where,
      include: {
        admin: {
          select: { id: true, name: true, avatar: true },
        },
        batches: {
          where: { isDeleted: false },
          select: {
            id: true,
            batchNumber: true,
            title: true,
            startDate: true,
            endDate: true,
            status: true,
          },
          orderBy: { batchNumber: "asc" },
        },
        _count: {
          select: {
            modules: true,
            enrollments: true,
            reviews: true,
            batches: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    sendResponse({
      res,
      message: "Courses fetched successfully",
      data: { courses, total: courses.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. GET /:id — Get a single course (PUBLIC)
//    ⚠️ SECURITY: videoId/videoUrl hidden for non-free lessons
//    unless the requester is an ADMIN or has an active enrollment.
// ═══════════════════════════════════════════════════════════
courseRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    // Determine if requester is enrolled or admin
    // (authMiddleware is not applied here — token is optional for this public route)
    let isAdmin = false;
    let hasEnrollment = false;

    // Try to read the token from headers manually (optional)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        // Import verifyToken inline to avoid circular deps
        const { verifyToken } = await import("../utils/jwt.js");
        const token = authHeader.split(" ")[1];
        if (token) {
          const payload = verifyToken(token);
          isAdmin = payload.role === "ADMIN";

          if (!isAdmin) {
            const enrollment = await prisma.enrollment.findFirst({
              where: {
                learnerId: payload.userId,
                courseId: id,
                status: { in: ["ACTIVE", "COMPLETED", "PENDING"] },
                isDeleted: false,
              },
            });
            hasEnrollment = !!enrollment;
          }
        }
      } catch {
        // Invalid token — ignore, treat as anonymous
      }
    }

    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        admin: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        batches: {
          where: { isDeleted: false },
          orderBy: { batchNumber: "asc" },
          include: {
            _count: {
              select: {
                enrollments: true,
                modules: true,
                liveSessions: true,
              },
            },
          },
        },
        modules: {
          where: { isDeleted: false, batchId: null },
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
                provider: true,
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
        _count: {
          select: {
            enrollments: true,
            reviews: true,
            batches: true,
          },
        },
      },
    });

    if (!course || course.isDeleted) {
      throw new AppError("Course not found", 404);
    }

    // Sanitize lessons — hide video content for non-free lessons
    // unless the requester is an admin or an enrolled learner.
    const canSeeFullContent = isAdmin || hasEnrollment;

    const sanitizedModules = course.modules.map((mod) => ({
      ...mod,
      lessons: mod.lessons.map((lesson) => {
        if (canSeeFullContent || lesson.isFree) {
          return lesson;
        }
        // Hide content fields for non-free lessons
        return {
          ...lesson,
          videoId: null,
          videoUrl: null,
          provider: null,
        };
      }),
    }));

    sendResponse({
      res,
      message: "Course fetched successfully",
      data: {
        ...course,
        modules: sanitizedModules,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 4. PATCH /:id — Update a course (ADMIN only)
// ═══════════════════════════════════════════════════════════
courseRouter.patch(
  "/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const {
        title,
        slug,
        description,
        courseType,
        thumbnail,
        price,
        level,
        status,
      } = req.body;

      const exists = await prisma.course.findUnique({ where: { id } });
      if (!exists || exists.isDeleted) {
        throw new AppError("Course not found", 404);
      }

      if (slug && slug !== exists.slug) {
        const dup = await prisma.course.findUnique({ where: { slug } });
        if (dup) {
          throw new AppError("Course with this slug already exists", 409);
        }
      }

      if (courseType && courseType !== exists.courseType) {
        throw new AppError(
          "Cannot change courseType after creation. Create a new course instead.",
          400
        );
      }

      const course = await prisma.course.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(slug && { slug }),
          ...(description && { description }),
          ...(thumbnail !== undefined && { thumbnail }),
          ...(price !== undefined && { price }),
          ...(level && { level }),
          ...(status && { status }),
        },
        include: {
          admin: {
            select: { id: true, name: true, avatar: true },
          },
        },
      });

      sendResponse({
        res,
        message: "Course updated successfully",
        data: course,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 5. DELETE /:id — Soft delete (ADMIN only)
// ═══════════════════════════════════════════════════════════
courseRouter.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;

      const exists = await prisma.course.findUnique({ where: { id } });
      if (!exists || exists.isDeleted) {
        throw new AppError("Course not found", 404);
      }

      await prisma.course.update({
        where: { id },
        data: { isDeleted: true },
      });

      sendResponse({ res, message: "Course deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
);

export default courseRouter;