import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const paymentRouter = Router();

paymentRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// 1. POST /submit — Learner submits manual payment info
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

    // Check if enrollment exists
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

    // Find pending order
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

    // Update order with payment info
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { senderNumber, transactionId, provider },
      include: {
        learner: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true, slug: true } },
        batch: { select: { id: true, batchNumber: true, title: true } },
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
// 2. GET /pending — All pending payments (ADMIN only)
// ═══════════════════════════════════════════════════════════
paymentRouter.get(
  "/pending",
  roleMiddleware("ADMIN"),
  async (_req, res, next) => {
    try {
      const orders = await prisma.order.findMany({
        where: {
          status: "PENDING",
          isDeleted: false,
          transactionId: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        include: {
          learner: { select: { id: true, name: true, email: true, avatar: true } },
          course: { select: { id: true, title: true, slug: true } },
          batch: { select: { id: true, batchNumber: true, title: true } },
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
  }
);

// ═══════════════════════════════════════════════════════════
// 3. GET /stats/all — Admin earning stats (ADMIN only)
//    Query: ?courseId=xxx&batchId=yyy  (optional filters)
// ═══════════════════════════════════════════════════════════
paymentRouter.get(
  "/stats/all",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const { courseId, batchId } = req.query;

      const where: any = { isDeleted: false };
      if (courseId && courseId !== "all") where.courseId = String(courseId);
      if (batchId && batchId !== "all") where.batchId = String(batchId);

      const [totalEarning, pendingCount, paidCount, failedCount] =
        await Promise.all([
          prisma.order.aggregate({
            where: { ...where, status: "PAID" },
            _sum: { amount: true },
          }),
          prisma.order.count({
            where: { ...where, status: "PENDING" },
          }),
          prisma.order.count({
            where: { ...where, status: "PAID" },
          }),
          prisma.order.count({
            where: { ...where, status: "FAILED" },
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
  }
);

// ═══════════════════════════════════════════════════════════
// 4. GET /all — All payments with filters (ADMIN only)
//    Query: ?courseId=xxx&batchId=yyy&status=PENDING|PAID|FAILED
//    ⚠️ MUST be before /:id route
// ═══════════════════════════════════════════════════════════
paymentRouter.get(
  "/all",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const { courseId, batchId, status } = req.query;

      const where: any = { isDeleted: false };
      if (courseId && courseId !== "all") where.courseId = String(courseId);
      if (batchId && batchId !== "all") where.batchId = String(batchId);
      if (status && status !== "all") where.status = String(status);

      const orders = await prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          learner: {
            select: { id: true, name: true, email: true, avatar: true },
          },
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
        message: "All payments fetched successfully",
        data: { orders, total: orders.length },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 5. GET /my/:learnerId — Learner's payment history
// ═══════════════════════════════════════════════════════════
paymentRouter.get("/my/:learnerId", async (req, res, next) => {
  try {
    const learnerId = req.params.learnerId as string;

    const orders = await prisma.order.findMany({
      where: { learnerId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      include: {
        course: { select: { id: true, title: true, slug: true, thumbnail: true } },
        batch: { select: { id: true, batchNumber: true, title: true } },
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
// 6. PATCH /:id/verify — Admin verifies payment (ADMIN only)
//    Body: { action: "APPROVE" | "REJECT", note? }
// ═══════════════════════════════════════════════════════════
paymentRouter.patch(
  "/:id/verify",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const { action, note } = req.body;

      if (!action || !["APPROVE", "REJECT"].includes(action)) {
        throw new AppError("action must be APPROVE or REJECT", 400);
      }

      // Find order
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

      // Find enrollment
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

      // ── APPROVE ──
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

        // Notify learner
        await prisma.notification.create({
          data: {
            userId: order.learnerId,
            batchId: order.batchId,
            type: "ANNOUNCEMENT",
            title: "Payment Confirmed",
            message: `Your payment of ৳${order.amount} has been verified. The course is now accessible.`,
            link: `/courses/${order.courseId}`,
          },
        });

        return sendResponse({
          res,
          message: "Payment verified. Enrollment is now ACTIVE.",
          data: { order: updatedOrder, enrollment: updatedEnrollment },
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

      // Notify learner
      await prisma.notification.create({
        data: {
          userId: order.learnerId,
          batchId: order.batchId,
          type: "ANNOUNCEMENT",
          title: "Payment Verification Failed",
          message:
            note ||
            "Your payment information could not be verified. Please contact support.",
          link: `/courses/${order.courseId}`,
        },
      });

      sendResponse({
        res,
        message: "Payment rejected. Enrollment cancelled.",
        data: { order: updatedOrder, enrollment: updatedEnrollment },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 7. GET /:id — Get a single payment
//    ⚠️ MUST be LAST
// ═══════════════════════════════════════════════════════════
paymentRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        learner: { select: { id: true, name: true, email: true, avatar: true } },
        course: { select: { id: true, title: true, slug: true, price: true } },
        batch: { select: { id: true, batchNumber: true, title: true } },
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

export default paymentRouter;