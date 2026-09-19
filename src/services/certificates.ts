import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const certificateRouter = Router();

certificateRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// Helper: Generate a unique certificate code
// ═══════════════════════════════════════════════════════════
function generateCertificateCode(): string {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `CERT-${year}-${random}${timestamp}`;
}

// ═══════════════════════════════════════════════════════════
// 1. POST /generate — Generate certificate after course completion
//    Body: { learnerId, courseId, batchId? }
//    ⚠️ Only the learner themselves or an ADMIN can generate
// ═══════════════════════════════════════════════════════════
certificateRouter.post("/generate", async (req, res, next) => {
  try {
    const { learnerId, courseId, batchId } = req.body;

    if (!learnerId || !courseId) {
      throw new AppError("learnerId and courseId are required", 400);
    }

    // Only the learner or an ADMIN can generate a certificate
    if (req.user!.userId !== learnerId && req.user!.role !== "ADMIN") {
      throw new AppError(
        "You can only generate your own certificate",
        403
      );
    }

    // Verify enrollment exists
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        learnerId,
        courseId,
        ...(batchId ? { batchId } : { batchId: null }),
        isDeleted: false,
      },
      include: {
        learner: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true } },
        batch: { select: { id: true, batchNumber: true, title: true } },
      },
    });

    if (!enrollment) {
      throw new AppError("Enrollment not found", 404);
    }

    // Check if certificate already exists
    const existing = await prisma.certificate.findFirst({
      where: { learnerId, courseId, batchId: batchId ?? null },
    });

    if (existing) {
      return sendResponse({
        res,
        message: "Certificate already exists",
        data: existing,
      });
    }

    // Require 100% progress
    if (enrollment.progress < 100) {
      throw new AppError(
        `Course not completed yet. Progress: ${enrollment.progress}%`,
        400
      );
    }

    // Create certificate
    const certificate = await prisma.certificate.create({
      data: {
        certificateCode: generateCertificateCode(),
        learnerId,
        courseId,
        batchId: batchId ?? null,
        learnerName: enrollment.learner.name,
        courseName: enrollment.course.title,
        batchName: enrollment.batch?.title ?? null,
      },
      include: {
        learner: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true } },
        batch: { select: { id: true, batchNumber: true, title: true } },
      },
    });

    // Mark enrollment as COMPLETED
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // Notify learner
    await prisma.notification.create({
      data: {
        userId: learnerId,
        batchId: batchId ?? null,
        type: "COURSE_COMPLETED",
        title: "Certificate Issued",
        message: `Congratulations on completing ${enrollment.course.title}!`,
        link: `/certificates/${certificate.id}`,
      },
    });

    sendResponse({
      res,
      statusCode: 201,
      message: "Certificate generated successfully",
      data: certificate,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 2. GET /my/:learnerId — Get all certificates for a learner
// ═══════════════════════════════════════════════════════════
certificateRouter.get("/my/:learnerId", async (req, res, next) => {
  try {
    const learnerId = req.params.learnerId as string;

    const certificates = await prisma.certificate.findMany({
      where: { learnerId },
      orderBy: { issuedAt: "desc" },
      include: {
        course: {
          select: { id: true, title: true, slug: true, thumbnail: true },
        },
        batch: {
          select: { id: true, batchNumber: true, title: true },
        },
      },
    });

    sendResponse({
      res,
      message: "Certificates fetched successfully",
      data: { certificates, total: certificates.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. GET /verify/:code — Verify a certificate (PUBLIC)
//    ⚠️ This route must NOT require auth — anyone can verify
// ═══════════════════════════════════════════════════════════
// (Handled separately below)

// ═══════════════════════════════════════════════════════════
// 4. GET /course/:courseId — All certificates for a course (ADMIN only)
// ═══════════════════════════════════════════════════════════
certificateRouter.get(
  "/course/:courseId",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const courseId = req.params.courseId as string;

      const certificates = await prisma.certificate.findMany({
        where: { courseId },
        orderBy: { issuedAt: "desc" },
        include: {
          learner: { select: { id: true, name: true, email: true } },
          batch: { select: { id: true, batchNumber: true, title: true } },
        },
      });

      sendResponse({
        res,
        message: "Certificates fetched successfully",
        data: { certificates, total: certificates.length },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 5. GET /:id — Get a single certificate
// ═══════════════════════════════════════════════════════════
certificateRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const certificate = await prisma.certificate.findUnique({
      where: { id },
      include: {
        learner: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true, slug: true } },
        batch: { select: { id: true, batchNumber: true, title: true } },
      },
    });

    if (!certificate) {
      throw new AppError("Certificate not found", 404);
    }

    sendResponse({
      res,
      message: "Certificate fetched successfully",
      data: certificate,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 6. DELETE /:id — Hard delete a certificate (ADMIN only)
//    Note: Certificate model has no isDeleted — hard delete is intended
// ═══════════════════════════════════════════════════════════
certificateRouter.delete(
  "/:id",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;

      const exists = await prisma.certificate.findUnique({ where: { id } });
      if (!exists) throw new AppError("Certificate not found", 404);

      await prisma.certificate.delete({ where: { id } });

      sendResponse({ res, message: "Certificate deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
);

export default certificateRouter;