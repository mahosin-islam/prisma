import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const paymentRouter = Router();

// ═══════════════════════════════════════════════════════════
// ১. POST /submit — ছাত্র পেমেন্ট তথ্য সাবমিট করবে
//    URL: POST /api/v1/payments/submit
//    Body: { enrollmentId, senderNumber, transactionId, provider }
// ═══════════════════════════════════════════════════════════
paymentRouter.post("/submit", async (req, res, next) => {
  try {
    const { enrollmentId, senderNumber, transactionId, provider } = req.body;

    if (!enrollmentId || !senderNumber || !transactionId || !provider) {
      throw new AppError(
        "enrollmentId, senderNumber, transactionId, and provider are required",
        400
      );
    }

    if (!["BKASH", "NAGAD"].includes(provider)) {
      throw new AppError("provider must be BKASH or NAGAD", 400);
    }

    // ── Enrollment আছে কি? ──
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment || enrollment.isDeleted) {
      throw new AppError("Enrollment not found", 404);
    }

    if (enrollment.status !== "PENDING") {
      throw new AppError(
        `Cannot submit payment. Enrollment status is ${enrollment.status}`,
        400
      );
    }

    // ── Order খোঁজো ──
    const order = await prisma.order.findFirst({
      where: {
        learnerId: enrollment.learnerId,
        courseId: enrollment.courseId,
        batchId: enrollment.batchId,
        status: "PENDING",
        isDeleted: false,
      },
    });

    if (!order) {
      throw new AppError("No pending order found for this enrollment", 404);
    }

    // ── Order আপডেট ──
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        senderNumber,
        transactionId,
        provider,
      },
      include: {
        learner: {
          select: { id: true, name: true, email: true },
        },
        course: {
          select: { id: true, title: true, slug: true },
        },
        batch: {
          select: { id: true, batchNumber: true, title: true },
        },
      },
    });

    sendResponse({
      res,
      message:
        "Payment info submitted successfully. Please wait for admin verification (usually within 24 hours).",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ২. PATCH /:id/verify — অ্যাডমিন verify করবে
//    URL: PATCH /api/v1/payments/:id/verify
//    Body: { action: "APPROVE" | "REJECT", note? }
// ═══════════════════════════════════════════════════════════
paymentRouter.patch("/:id/verify", async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { action, note } = req.body;

    if (!action || !["APPROVE", "REJECT"].includes(action)) {
      throw new AppError("action must be APPROVE or REJECT", 400);
    }

    // ── Order খোঁজো ──
    const order = await prisma.order.findUnique({
      where: { id },
      include: { learner: true, course: true, batch: true },
    });

    if (!order || order.isDeleted) {
      throw new AppError("Order not found", 404);
    }

    if (order.status !== "PENDING") {
      throw new AppError(`Order already ${order.status}`, 400);
    }

    if (!order.transactionId) {
      throw new AppError(
        "Cannot verify. Student has not submitted payment info yet.",
        400
      );
    }

    // ── Enrollment খোঁজো ──
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        learnerId: order.learnerId,
        courseId: order.courseId,
        batchId: order.batchId,
        isDeleted: false,
      },
    });

    if (!enrollment) {
      throw new AppError("Enrollment not found", 404);
    }

    // ── APPROVE বা REJECT ──
    if (action === "APPROVE") {
      const [updatedOrder, updatedEnrollment] = await Promise.all([
        prisma.order.update({
          where: { id },
          data: { status: "PAID" },
        }),
        prisma.enrollment.update({
          where: { id: enrollment.id },
          data: { status: "ACTIVE" },
        }),
      ]);

      // ── ছাত্রকে notification ──
      await prisma.notification.create({
        data: {
          userId: order.learnerId,
          batchId: order.batchId,
          type: "ANNOUNCEMENT",
          title: "✅ পেমেন্ট নিশ্চিত হয়েছে",
          message: `আপনার পেমেন্ট ৳${order.amount} সফল হয়েছে। কোর্স এখন অ্যাক্সেসযোগ্য।`,
          link: `/courses/${order.courseId}`,
        },
      });

      return sendResponse({
        res,
        message: "Payment verified. Enrollment is now ACTIVE.",
        data: {
          order: updatedOrder,
          enrollment: updatedEnrollment,
        },
      });
    }

    // ── REJECT ──
    const [updatedOrder, updatedEnrollment] = await Promise.all([
      prisma.order.update({
        where: { id },
        data: { status: "FAILED" },
      }),
      prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "CANCELLED" },
      }),
    ]);

    // ── ছাত্রকে notification ──
    await prisma.notification.create({
      data: {
        userId: order.learnerId,
        batchId: order.batchId,
        type: "ANNOUNCEMENT",
        title: "❌ পেমেন্ট যাচাই হয়নি",
        message:
          note ||
          "আপনার পেমেন্ট তথ্য যাচাই করা যায়নি। সহায়তার জন্য যোগাযোগ করুন।",
        link: `/courses/${order.courseId}`,
      },
    });

    sendResponse({
      res,
      message: "Payment rejected. Enrollment cancelled.",
      data: {
        order: updatedOrder,
        enrollment: updatedEnrollment,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৩. GET /pending — সব pending payment (অ্যাডমিন)
//    URL: GET /api/v1/payments/pending
// ═══════════════════════════════════════════════════════════
paymentRouter.get("/pending", async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        status: "PENDING",
        isDeleted: false,
        transactionId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      include: {
        learner: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        course: {
          select: { id: true, title: true, slug: true },
        },
        batch: {
          select: { id: true, batchNumber: true, title: true },
        },
      },
    });

    sendResponse({
      res,
      message: "Pending payments fetched successfully",
      data: { orders, total: orders.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৪. GET /my/:learnerId — ছাত্রের সব পেমেন্ট
//    URL: GET /api/v1/payments/my/:learnerId
// ═══════════════════════════════════════════════════════════
paymentRouter.get("/my/:learnerId", async (req, res, next) => {
  try {
    const learnerId = req.params.learnerId as string;

    const orders = await prisma.order.findMany({
      where: { learnerId, isDeleted: false },
      orderBy: { createdAt: "desc" },
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
      message: "My payments fetched successfully",
      data: { orders, total: orders.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৫. GET /:id — একটা payment দেখা
//    URL: GET /api/v1/payments/:id
// ═══════════════════════════════════════════════════════════
paymentRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        learner: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        course: {
          select: { id: true, title: true, slug: true, price: true },
        },
        batch: {
          select: { id: true, batchNumber: true, title: true },
        },
      },
    });

    if (!order || order.isDeleted) {
      throw new AppError("Payment not found", 404);
    }

    sendResponse({
      res,
      message: "Payment fetched successfully",
      data: order,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৬. GET /stats/all — অ্যাডমিন earning stats
//    URL: GET /api/v1/payments/stats/all
// ═══════════════════════════════════════════════════════════
paymentRouter.get("/stats/all", async (_req, res, next) => {
  try {
    const [totalEarning, pendingCount, paidCount, failedCount] =
      await Promise.all([
        prisma.order.aggregate({
          where: { status: "PAID", isDeleted: false },
          _sum: { amount: true },
        }),
        prisma.order.count({
          where: { status: "PENDING", isDeleted: false },
        }),
        prisma.order.count({
          where: { status: "PAID", isDeleted: false },
        }),
        prisma.order.count({
          where: { status: "FAILED", isDeleted: false },
        }),
      ]);

    sendResponse({
      res,
      message: "Payment stats fetched successfully",
      data: {
        totalEarning: totalEarning._sum.amount ?? 0,
        pendingPayments: pendingCount,
        successfulPayments: paidCount,
        failedPayments: failedCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default paymentRouter;