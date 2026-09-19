import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const moduleRouter = Router();

moduleRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// 1. POST / — Create a new module (ADMIN only)
//    Body: { courseId, batchId?, title, intro?, order }
// ═══════════════════════════════════════════════════════════
moduleRouter.post("/", roleMiddleware("ADMIN"), async (req, res, next) => {
  try {
    const { courseId, batchId, title, intro, order } = req.body;

    if (!courseId || !title || order === undefined) {
      throw new AppError("courseId, title, and order are required", 400);
    }

    // Check if course exists
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course || course.isDeleted) {
      throw new AppError("Course not found", 404);
    }

    // BATCH courses require batchId
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
    }

    // FIXED courses must NOT have batchId
    if (course.courseType === "FIXED" && batchId) {
      throw new AppError("FIXED courses cannot have batchId", 400);
    }

    const newModule = await prisma.module.create({
      data: {
        courseId,
        batchId: batchId ?? null,
        title,
        intro: intro ?? null,
        order,
      },
      include: {
        course: {
          select: { id: true, title: true, slug: true, courseType: true },
        },
        batch: {
          select: { id: true, batchNumber: true, title: true },
        },
        _count: {
          select: { lessons: true, assignments: true },
        },
      },
    });

    sendResponse({
      res,
      statusCode: 201,
      message: "Module created successfully",
      data: newModule,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 2. GET /course/:courseId — Get all modules of a course
//    Query: ?batchId=xxx (required for BATCH courses)
// ═══════════════════════════════════════════════════════════
moduleRouter.get("/course/:courseId", async (req, res, next) => {
  try {
    const courseId = req.params.courseId as string;
    const batchId = req.query.batchId as string | undefined;

    const where = {
      courseId,
      isDeleted: false,
      ...(batchId !== undefined && { batchId }),
    };

    const modules = await prisma.module.findMany({
      where,
      orderBy: { order: "asc" },
      include: {
        lessons: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            type: true,
            order: true,
            isFree: true,
            isPublished: true,
          },
        },
        _count: {
          select: { lessons: true, assignments: true },
        },
      },
    });

    sendResponse({
      res,
      message: "Modules fetched successfully",
      data: { modules, total: modules.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. GET /:id — Get a single module (with lessons + assignments)
// ═══════════════════════════════════════════════════════════
moduleRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const module = await prisma.module.findUnique({
      where: { id },
      include: {
        course: {
          select: { id: true, title: true, slug: true, courseType: true },
        },
        batch: {
          select: { id: true, batchNumber: true, title: true },
        },
        lessons: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
        },
        assignments: {
          where: { isDeleted: false },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!module || module.isDeleted) {
      throw new AppError("Module not found", 404);
    }

    sendResponse({
      res,
      message: "Module fetched successfully",
      data: module,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 4. PATCH /:id — Update a module (ADMIN only)
//    Body: { title?, intro?, order? }
// ═══════════════════════════════════════════════════════════
moduleRouter.patch("/:id", roleMiddleware("ADMIN"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { title, intro, order } = req.body;

    const exists = await prisma.module.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("Module not found", 404);
    }

    const updated = await prisma.module.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(intro !== undefined && { intro }),
        ...(order !== undefined && { order }),
      },
      include: {
        _count: {
          select: { lessons: true, assignments: true },
        },
      },
    });

    sendResponse({
      res,
      message: "Module updated successfully",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 5. DELETE /:id — Soft delete a module (ADMIN only)
// ═══════════════════════════════════════════════════════════
moduleRouter.delete("/:id", roleMiddleware("ADMIN"), async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.module.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("Module not found", 404);
    }

    await prisma.module.update({
      where: { id },
      data: { isDeleted: true },
    });

    sendResponse({ res, message: "Module deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default moduleRouter;