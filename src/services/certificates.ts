import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const certificateRouter = Router();

// ═══════════════════════════════════════════════════════════
// Helper: ইউনিক সার্টিফিকেট কোড তৈরি
// ═══════════════════════════════════════════════════════════
function generateCertificateCode(): string {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `CERT-${year}-${random}${timestamp}`;
}

// ═══════════════════════════════════════════════════════════
// ১. POST /generate — সার্টিফিকেট generate করো
//    URL: POST /api/v1/certificates/generate
//    Body: { learnerId, courseId, batchId? }
// ═══════════════════════════════════════════════════════════
certificateRouter.post("/generate", async (req, res, next) => {
  try {
    const { learnerId, courseId, batchId } = req.body;

    if (!learnerId || !courseId) {
      throw new AppError("learnerId and courseId are required", 400);
    }

    // ── Enrollment চেক ──
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

    // ── আগেই সার্টিফিকেট আছে কি? ──
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

    // ── Progress 100% চেক ──
    if (enrollment.progress < 100) {
      throw new AppError(
        `Course not completed yet. Progress: ${enrollment.progress}%`,
        400
      );
    }

    // ── সার্টিফিকেট তৈরি ──
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

    // ── Enrollment COMPLETED করো ──
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // ── ছাত্রকে notification ──
    await prisma.notification.create({
      data: {
        userId: learnerId,
        batchId: batchId ?? null,
        type: "COURSE_COMPLETED",
        title: "🎉 অভিনন্দন! সার্টিফিকেট তৈরি হয়েছে",
        message: `${enrollment.course.title} সম্পন্ন করার জন্য অভিনন্দন!`,
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
// ২. GET /my/:learnerId — আমার সব সার্টিফিকেট
//    URL: GET /api/v1/certificates/my/:learnerId
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
// ৩. GET /verify/:code — সার্টিফিকেট verify (পাবলিক)
//    URL: GET /api/v1/certificates/verify/:code
// ═══════════════════════════════════════════════════════════
certificateRouter.get("/verify/:code", async (req, res, next) => {
  try {
    const code = req.params.code as string;

    const certificate = await prisma.certificate.findUnique({
      where: { certificateCode: code },
      include: {
        learner: { select: { id: true, name: true } },
        course: { select: { id: true, title: true, slug: true } },
        batch: { select: { id: true, batchNumber: true, title: true } },
      },
    });

    if (!certificate) {
      throw new AppError("Invalid certificate code", 404);
    }

    sendResponse({
      res,
      message: "Certificate verified successfully",
      data: {
        isValid: true,
        certificate,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৪. GET /:id — একটা সার্টিফিকেট দেখা
//    URL: GET /api/v1/certificates/:id
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
// ৫. GET /course/:courseId — কোর্সের সব সার্টিফিকেট (অ্যাডমিন)
//    URL: GET /api/v1/certificates/course/:courseId
// ═══════════════════════════════════════════════════════════
certificateRouter.get("/course/:courseId", async (req, res, next) => {
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
});

// ═══════════════════════════════════════════════════════════
// ৬. DELETE /:id — সার্টিফিকেট ডিলিট (অ্যাডমিন)
//    URL: DELETE /api/v1/certificates/:id
// ═══════════════════════════════════════════════════════════
certificateRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.certificate.findUnique({ where: { id } });
    if (!exists) throw new AppError("Certificate not found", 404);

    await prisma.certificate.delete({ where: { id } });

    sendResponse({ res, message: "Certificate deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default certificateRouter;