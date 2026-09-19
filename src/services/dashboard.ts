import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const dashboardRouter = Router();

// ═══════════════════════════════════════════════════════════
// ১. GET /admin/stats — অ্যাডমিন সামগ্রিক স্ট্যাটস
//    URL: GET /api/v1/dashboard/admin/stats
// ═══════════════════════════════════════════════════════════
dashboardRouter.get("/admin/stats", async (_req, res, next) => {
  try {
    const [
      totalUsers,
      totalLearners,
      totalCourses,
      totalFixedCourses,
      totalBatchCourses,
      totalBatches,
      totalActiveBatches,
      totalEnrollments,
      totalActiveEnrollments,
      totalOrders,
      totalRevenue,
      pendingPayments,
      totalCertificates,
      totalAssignments,
      totalNotifications,
    ] = await Promise.all([
      prisma.user.count({ where: { isDeleted: false } }),
      prisma.user.count({ where: { role: "LEARNER", isDeleted: false } }),
      prisma.course.count({ where: { isDeleted: false } }),
      prisma.course.count({
        where: { courseType: "FIXED", isDeleted: false },
      }),
      prisma.course.count({
        where: { courseType: "BATCH", isDeleted: false },
      }),
      prisma.batch.count({ where: { isDeleted: false } }),
      prisma.batch.count({ where: { status: "ACTIVE", isDeleted: false } }),
      prisma.enrollment.count({ where: { isDeleted: false } }),
      prisma.enrollment.count({
        where: { status: "ACTIVE", isDeleted: false },
      }),
      prisma.order.count({ where: { isDeleted: false } }),
      prisma.order.aggregate({
        where: { status: "PAID", isDeleted: false },
        _sum: { amount: true },
      }),
      prisma.order.count({
        where: { status: "PENDING", isDeleted: false },
      }),
      prisma.certificate.count(),
      prisma.assignment.count({ where: { isDeleted: false } }),
      prisma.notification.count(),
    ]);

    sendResponse({
      res,
      message: "Admin stats fetched successfully",
      data: {
        users: {
          total: totalUsers,
          learners: totalLearners,
        },
        courses: {
          total: totalCourses,
          fixed: totalFixedCourses,
          batch: totalBatchCourses,
        },
        batches: {
          total: totalBatches,
          active: totalActiveBatches,
        },
        enrollments: {
          total: totalEnrollments,
          active: totalActiveEnrollments,
        },
        payments: {
          totalOrders,
          totalRevenue: totalRevenue._sum.amount ?? 0,
          pendingPayments,
        },
        others: {
          certificates: totalCertificates,
          assignments: totalAssignments,
          notifications: totalNotifications,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ২. GET /admin/revenue — মাসিক আয় (শেষ ১২ মাস)
//    URL: GET /api/v1/dashboard/admin/revenue
// ═══════════════════════════════════════════════════════════
dashboardRouter.get("/admin/revenue", async (_req, res, next) => {
  try {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const orders = await prisma.order.findMany({
      where: {
        status: "PAID",
        isDeleted: false,
        createdAt: { gte: twelveMonthsAgo },
      },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // ── মাস অনুযায়ী গ্রুপ ──
    const monthly: Record<string, number> = {};

    orders.forEach((order) => {
      const key = `${order.createdAt.getFullYear()}-${String(
        order.createdAt.getMonth() + 1
      ).padStart(2, "0")}`;
      monthly[key] = (monthly[key] || 0) + order.amount;
    });

    const result = Object.entries(monthly).map(([month, revenue]) => ({
      month,
      revenue,
    }));

    sendResponse({
      res,
      message: "Revenue stats fetched successfully",
      data: { monthly: result },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৩. GET /admin/course-earnings — কোর্স অনুযায়ী আয়
//    URL: GET /api/v1/dashboard/admin/course-earnings
// ═══════════════════════════════════════════════════════════
dashboardRouter.get("/admin/course-earnings", async (_req, res, next) => {
  try {
    const earnings = await prisma.order.groupBy({
      by: ["courseId"],
      where: { status: "PAID", isDeleted: false },
      _sum: { amount: true },
      _count: { id: true },
    });

    const courseIds = earnings.map((e) => e.courseId);

    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, title: true, slug: true, thumbnail: true },
    });

    const result = earnings.map((e) => {
      const course = courses.find((c) => c.id === e.courseId);
      return {
        courseId: e.courseId,
        courseTitle: course?.title ?? "Unknown",
        thumbnail: course?.thumbnail ?? null,
        totalEarnings: e._sum.amount ?? 0,
        totalOrders: e._count.id,
      };
    });

    // ── বেশি আয় অনুযায়ী সাজাও ──
    result.sort((a, b) => b.totalEarnings - a.totalEarnings);

    sendResponse({
      res,
      message: "Course earnings fetched successfully",
      data: { earnings: result },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৪. GET /admin/batch-earnings — ব্যাচ অনুযায়ী আয়
//    URL: GET /api/v1/dashboard/admin/batch-earnings
// ═══════════════════════════════════════════════════════════
dashboardRouter.get("/admin/batch-earnings", async (_req, res, next) => {
  try {
    const earnings = await prisma.order.groupBy({
      by: ["batchId"],
      where: {
        status: "PAID",
        isDeleted: false,
        batchId: { not: null },
      },
      _sum: { amount: true },
      _count: { id: true },
    });

    const batchIds = earnings
      .map((e) => e.batchId)
      .filter((b): b is string => b !== null);

    const batches = await prisma.batch.findMany({
      where: { id: { in: batchIds } },
      select: {
        id: true,
        batchNumber: true,
        title: true,
        status: true,
        course: { select: { id: true, title: true } },
      },
    });

    const result = earnings.map((e) => {
      const batch = batches.find((b) => b.id === e.batchId);
      return {
        batchId: e.batchId,
        batchNumber: batch?.batchNumber ?? 0,
        batchTitle: batch?.title ?? "Unknown",
        batchStatus: batch?.status ?? "UNKNOWN",
        courseTitle: batch?.course.title ?? "Unknown",
        totalEarnings: e._sum.amount ?? 0,
        totalOrders: e._count.id,
      };
    });

    result.sort((a, b) => b.totalEarnings - a.totalEarnings);

    sendResponse({
      res,
      message: "Batch earnings fetched successfully",
      data: { earnings: result },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৫. GET /admin/top-students — সবচেয়ে সক্রিয় ছাত্র
//    URL: GET /api/v1/dashboard/admin/top-students
// ═══════════════════════════════════════════════════════════
dashboardRouter.get("/admin/top-students", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 10;

    const enrollments = await prisma.enrollment.groupBy({
      by: ["learnerId"],
      where: { isDeleted: false },
      _count: { id: true },
      _sum: { progress: true },
    });

    enrollments.sort((a, b) => b._count.id - a._count.id);

    const topIds = enrollments.slice(0, limit).map((e) => e.learnerId);

    const users = await prisma.user.findMany({
      where: { id: { in: topIds }, isDeleted: false },
      select: { id: true, name: true, email: true, avatar: true },
    });

    const result = topIds.map((id, index) => {
      const user = users.find((u) => u.id === id);
      const stat = enrollments.find((e) => e.learnerId === id);
      return {
        rank: index + 1,
        userId: id,
        name: user?.name ?? "Unknown",
        email: user?.email ?? "",
        avatar: user?.avatar ?? null,
        totalEnrollments: stat?._count.id ?? 0,
      };
    });

    sendResponse({
      res,
      message: "Top students fetched successfully",
      data: { students: result },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৬. GET /learner/:learnerId — ছাত্রের ড্যাশবোর্ড
//    URL: GET /api/v1/dashboard/learner/:learnerId
// ═══════════════════════════════════════════════════════════
dashboardRouter.get("/learner/:learnerId", async (req, res, next) => {
  try {
    const learnerId = req.params.learnerId as string;

    const [
      totalEnrollments,
      activeEnrollments,
      completedEnrollments,
      totalCertificates,
      totalAssignments,
      totalNotifications,
      unreadNotifications,
      recentEnrollments,
    ] = await Promise.all([
      prisma.enrollment.count({
        where: { learnerId, isDeleted: false },
      }),
      prisma.enrollment.count({
        where: { learnerId, status: "ACTIVE", isDeleted: false },
      }),
      prisma.enrollment.count({
        where: { learnerId, status: "COMPLETED", isDeleted: false },
      }),
      prisma.certificate.count({ where: { learnerId } }),
      prisma.assignmentSubmission.count({ where: { learnerId } }),
      prisma.notification.count({ where: { userId: learnerId } }),
      prisma.notification.count({
        where: { userId: learnerId, isRead: false },
      }),
      prisma.enrollment.findMany({
        where: { learnerId, isDeleted: false },
        orderBy: { enrolledAt: "desc" },
        take: 5,
        include: {
          course: {
            select: {
              id: true,
              title: true,
              thumbnail: true,
              courseType: true,
            },
          },
          batch: {
            select: { id: true, batchNumber: true, title: true },
          },
        },
      }),
    ]);

    sendResponse({
      res,
      message: "Learner dashboard fetched successfully",
      data: {
        enrollments: {
          total: totalEnrollments,
          active: activeEnrollments,
          completed: completedEnrollments,
        },
        certificates: totalCertificates,
        assignments: totalAssignments,
        notifications: {
          total: totalNotifications,
          unread: unreadNotifications,
        },
        recentEnrollments,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৭. GET /admin/recent-activity — সাম্প্রতিক কার্যক্রম
//    URL: GET /api/v1/dashboard/admin/recent-activity
// ═══════════════════════════════════════════════════════════
dashboardRouter.get("/admin/recent-activity", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 10;

    const [recentUsers, recentEnrollments, recentOrders, recentReviews] =
      await Promise.all([
        prisma.user.findMany({
          where: { isDeleted: false },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            createdAt: true,
          },
        }),
        prisma.enrollment.findMany({
          where: { isDeleted: false },
          orderBy: { enrolledAt: "desc" },
          take: limit,
          include: {
            learner: { select: { id: true, name: true } },
            course: { select: { id: true, title: true } },
          },
        }),
        prisma.order.findMany({
          where: { status: "PAID", isDeleted: false },
          orderBy: { updatedAt: "desc" },
          take: limit,
          include: {
            learner: { select: { id: true, name: true } },
            course: { select: { id: true, title: true } },
          },
        }),
        prisma.review.findMany({
          where: { isDeleted: false },
          orderBy: { createdAt: "desc" },
          take: limit,
          include: {
            learner: { select: { id: true, name: true } },
            course: { select: { id: true, title: true } },
          },
        }),
      ]);

    sendResponse({
      res,
      message: "Recent activity fetched successfully",
      data: {
        recentUsers,
        recentEnrollments,
        recentOrders,
        recentReviews,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default dashboardRouter;