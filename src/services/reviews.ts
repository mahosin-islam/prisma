import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const reviewRouter = Router();

// ═══════════════════════════════════════════════════════════
// 1. POST / — Create a new review (Learner only)
//    URL: POST /api/v1/reviews
//    Body: { learnerId, courseId, rating, comment? }
// ═══════════════════════════════════════════════════════════
reviewRouter.post("/", authMiddleware, async (req, res, next) => {
  try {
    const { learnerId, courseId, rating, comment } = req.body;

    if (!learnerId || !courseId || rating === undefined) {
      throw new AppError("learnerId, courseId, and rating are required", 400);
    }

    if (rating < 1 || rating > 5) {
      throw new AppError("Rating must be between 1 and 5", 400);
    }

    // Check if learner is enrolled in the course
    const enrollment = await prisma.enrollment.findFirst({
      where: { learnerId, courseId, isDeleted: false },
    });

    if (!enrollment) {
      throw new AppError("You must enroll before reviewing this course", 403);
    }

    // Prevent duplicate reviews
    const existing = await prisma.review.findFirst({
      where: { learnerId, courseId, isDeleted: false },
    });

    if (existing) {
      throw new AppError("You have already reviewed this course", 409);
    }

    // Create review
    const review = await prisma.review.create({
      data: {
        learnerId,
        courseId,
        rating,
        comment: comment ?? null,
      },
      include: {
        learner: { select: { id: true, name: true, avatar: true } },
        course: { select: { id: true, title: true, slug: true } },
      },
    });

    sendResponse({
      res,
      statusCode: 201,
      message: "Review submitted successfully",
      data: review,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 2. GET /course/:courseId — All reviews for a course (Public)
//    URL: GET /api/v1/reviews/course/:courseId
// ═══════════════════════════════════════════════════════════
reviewRouter.get("/course/:courseId", async (req, res, next) => {
  try {
    const courseId = req.params.courseId as string;

    const reviews = await prisma.review.findMany({
      where: { courseId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      include: {
        learner: { select: { id: true, name: true, avatar: true } },
      },
    });

    const totalReviews = reviews.length;

    const averageRating =
      totalReviews > 0
        ? Number(
            (
              reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
            ).toFixed(1)
          )
        : 0;

    const starBreakdown = {
      5: reviews.filter((r) => r.rating === 5).length,
      4: reviews.filter((r) => r.rating === 4).length,
      3: reviews.filter((r) => r.rating === 3).length,
      2: reviews.filter((r) => r.rating === 2).length,
      1: reviews.filter((r) => r.rating === 1).length,
    };

    sendResponse({
      res,
      message: "Reviews fetched successfully",
      data: { reviews, total: totalReviews, averageRating, starBreakdown },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. GET /stats/:courseId — Rating stats for a course (Public)
//    URL: GET /api/v1/reviews/stats/:courseId
// ═══════════════════════════════════════════════════════════
reviewRouter.get("/stats/:courseId", async (req, res, next) => {
  try {
    const courseId = req.params.courseId as string;

    const reviews = await prisma.review.findMany({
      where: { courseId, isDeleted: false },
      select: { rating: true },
    });

    const total = reviews.length;
    const average =
      total > 0
        ? Number(
            (
              reviews.reduce((sum, r) => sum + r.rating, 0) / total
            ).toFixed(1)
          )
        : 0;

    const starBreakdown = {
      5: reviews.filter((r) => r.rating === 5).length,
      4: reviews.filter((r) => r.rating === 4).length,
      3: reviews.filter((r) => r.rating === 3).length,
      2: reviews.filter((r) => r.rating === 2).length,
      1: reviews.filter((r) => r.rating === 1).length,
    };

    sendResponse({
      res,
      message: "Review stats fetched successfully",
      data: { total, average, starBreakdown },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 4. GET /my/:learnerId — My reviews (Requires auth)
//    URL: GET /api/v1/reviews/my/:learnerId
// ═══════════════════════════════════════════════════════════
reviewRouter.get("/my/:learnerId", authMiddleware, async (req, res, next) => {
  try {
    const learnerId = req.params.learnerId as string;

    const reviews = await prisma.review.findMany({
      where: { learnerId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      include: {
        course: {
          select: { id: true, title: true, slug: true, thumbnail: true },
        },
      },
    });

    sendResponse({
      res,
      message: "My reviews fetched successfully",
      data: { reviews, total: reviews.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 5. GET /:id — Single review (Public)
//    URL: GET /api/v1/reviews/:id
// ═══════════════════════════════════════════════════════════
reviewRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const review = await prisma.review.findFirst({
      where: { id, isDeleted: false },
      include: {
        learner: { select: { id: true, name: true, avatar: true } },
        course: { select: { id: true, title: true, slug: true } },
      },
    });

    if (!review) {
      throw new AppError("Review not found", 404);
    }

    sendResponse({
      res,
      message: "Review fetched successfully",
      data: review,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 6. PATCH /:id — Update a review (Owner only)
//    URL: PATCH /api/v1/reviews/:id
//    Body: { rating?, comment? }
// ═══════════════════════════════════════════════════════════
reviewRouter.patch("/:id", authMiddleware, async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { rating, comment } = req.body;

    const exists = await prisma.review.findFirst({
      where: { id, isDeleted: false },
    });

    if (!exists) {
      throw new AppError("Review not found", 404);
    }

    if (rating !== undefined && (rating < 1 || rating > 5)) {
      throw new AppError("Rating must be between 1 and 5", 400);
    }

    const review = await prisma.review.update({
      where: { id },
      data: {
        ...(rating !== undefined && { rating }),
        ...(comment !== undefined && { comment }),
      },
      include: {
        learner: { select: { id: true, name: true, avatar: true } },
        course: { select: { id: true, title: true, slug: true } },
      },
    });

    sendResponse({
      res,
      message: "Review updated successfully",
      data: review,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 7. DELETE /:id — Soft delete review (Owner or Admin)
//    URL: DELETE /api/v1/reviews/:id
// ═══════════════════════════════════════════════════════════
reviewRouter.delete("/:id", authMiddleware, async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.review.findFirst({
      where: { id, isDeleted: false },
    });

    if (!exists) {
      throw new AppError("Review not found", 404);
    }

    await prisma.review.update({
      where: { id },
      data: { isDeleted: true },
    });

    sendResponse({ res, message: "Review deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default reviewRouter;