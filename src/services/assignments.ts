import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";

const assignmentRouter = Router();

// ═══════════════════════════════════════════════════════════
// ১. POST / — নতুন অ্যাসাইনমেন্ট তৈরি (অ্যাডমিন)
//    URL: POST /api/v1/assignments
//    Body: { moduleId, title, description?, docUrl?,
//            deadline?, totalMarks?, notifyStudents? }
// ═══════════════════════════════════════════════════════════
assignmentRouter.post("/", async (req, res, next) => {
  try {
    const {
      moduleId,
      title,
      description,
      docUrl,
      deadline,
      totalMarks,
      notifyStudents,
    } = req.body;

    if (!moduleId || !title) {
      throw new AppError("moduleId and title are required", 400);
    }

    const moduleData = await prisma.module.findUnique({
      where: { id: moduleId },
      include: { course: true },
    });

    if (!moduleData || moduleData.isDeleted) {
      throw new AppError("Module not found", 404);
    }

    const assignment = await prisma.assignment.create({
      data: {
        moduleId,
        title,
        description: description ?? null,
        docUrl: docUrl ?? null,
        deadline: deadline ? new Date(deadline) : null,
        totalMarks: totalMarks ?? 100,
      },
      include: {
        module: {
          select: { id: true, title: true, courseId: true, batchId: true },
        },
      },
    });

    // ── Notification পাঠাও ──
    if (notifyStudents) {
      let enrollments;

      if (moduleData.batchId) {
        enrollments = await prisma.enrollment.findMany({
          where: {
            batchId: moduleData.batchId,
            status: "ACTIVE",
            isDeleted: false,
          },
          select: { learnerId: true },
        });
      } else {
        enrollments = await prisma.enrollment.findMany({
          where: {
            courseId: moduleData.courseId,
            status: "ACTIVE",
            isDeleted: false,
          },
          select: { learnerId: true },
        });
      }

      if (enrollments.length > 0) {
        await prisma.notification.createMany({
          data: enrollments.map((e) => ({
            userId: e.learnerId,
            batchId: moduleData.batchId,
            type: "NEW_ASSIGNMENT",
            title: "📝 নতুন অ্যাসাইনমেন্ট",
            message: `${title} — জমা দেওয়ার শেষ তারিখ ${deadline ?? "নেই"}`,
            link: `/assignments/${assignment.id}`,
          })),
        });
      }
    }

    sendResponse({
      res,
      statusCode: 201,
      message: notifyStudents
        ? "Assignment created and students notified"
        : "Assignment created successfully",
      data: assignment,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ২. GET /module/:moduleId — একটা মডিউলের সব অ্যাসাইনমেন্ট
//    URL: GET /api/v1/assignments/module/:moduleId
// ═══════════════════════════════════════════════════════════
assignmentRouter.get("/module/:moduleId", async (req, res, next) => {
  try {
    const moduleId = req.params.moduleId as string;

    const assignments = await prisma.assignment.findMany({
      where: { moduleId, isDeleted: false },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { submissions: true } },
      },
    });

    sendResponse({
      res,
      message: "Assignments fetched successfully",
      data: { assignments, total: assignments.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৩. GET /:id — একটা অ্যাসাইনমেন্ট দেখা
//    URL: GET /api/v1/assignments/:id
// ═══════════════════════════════════════════════════════════
assignmentRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const assignment = await prisma.assignment.findUnique({
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
        submissions: {
          orderBy: { submittedAt: "desc" },
          include: {
            learner: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
      },
    });

    if (!assignment || assignment.isDeleted) {
      throw new AppError("Assignment not found", 404);
    }

    sendResponse({
      res,
      message: "Assignment fetched successfully",
      data: assignment,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৪. PATCH /:id — আপডেট (অ্যাডমিন)
//    URL: PATCH /api/v1/assignments/:id
// ═══════════════════════════════════════════════════════════
assignmentRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { title, description, docUrl, deadline, totalMarks } = req.body;

    const exists = await prisma.assignment.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("Assignment not found", 404);
    }

    const assignment = await prisma.assignment.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(docUrl !== undefined && { docUrl }),
        ...(deadline !== undefined && {
          deadline: deadline ? new Date(deadline) : null,
        }),
        ...(totalMarks !== undefined && { totalMarks }),
      },
    });

    sendResponse({
      res,
      message: "Assignment updated successfully",
      data: assignment,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৫. DELETE /:id — সফট ডিলিট
//    URL: DELETE /api/v1/assignments/:id
// ═══════════════════════════════════════════════════════════
assignmentRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.assignment.findUnique({ where: { id } });
    if (!exists || exists.isDeleted) {
      throw new AppError("Assignment not found", 404);
    }

    await prisma.assignment.update({
      where: { id },
      data: { isDeleted: true },
    });

    sendResponse({ res, message: "Assignment deleted successfully" });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৬. POST /:id/submit — ছাত্র অ্যাসাইনমেন্ট জমা দেবে
//    URL: POST /api/v1/assignments/:id/submit
//    Body: { learnerId, answerUrl, note? }
// ═══════════════════════════════════════════════════════════
assignmentRouter.post("/:id/submit", async (req, res, next) => {
  try {
    const assignmentId = req.params.id as string;
    const { learnerId, answerUrl, note } = req.body;

    if (!learnerId || !answerUrl) {
      throw new AppError("learnerId and answerUrl are required", 400);
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { module: true },
    });

    if (!assignment || assignment.isDeleted) {
      throw new AppError("Assignment not found", 404);
    }

    // ── এনরোলমেন্ট চেক ──
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        learnerId,
        courseId: assignment.module.courseId,
        ...(assignment.module.batchId && {
          batchId: assignment.module.batchId,
        }),
        status: "ACTIVE",
        isDeleted: false,
      },
    });

    if (!enrollment) {
      throw new AppError("You are not enrolled in this course", 403);
    }

    // ── deadline পার হয়েছে? ──
    if (assignment.deadline && new Date() > assignment.deadline) {
      throw new AppError("Deadline has passed", 400);
    }

    // ── আগেই জমা দিয়েছে কি? ──
    const existing = await prisma.assignmentSubmission.findFirst({
      where: { assignmentId, learnerId },
    });

    if (existing) {
      throw new AppError("You have already submitted this assignment", 409);
    }

    const submission = await prisma.assignmentSubmission.create({
      data: {
        assignmentId,
        learnerId,
        answerUrl,
        note: note ?? null,
        status: "SUBMITTED",
      },
      include: {
        assignment: {
          select: { id: true, title: true, totalMarks: true, deadline: true },
        },
      },
    });

    sendResponse({
      res,
      statusCode: 201,
      message: "Assignment submitted successfully",
      data: submission,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৭. PATCH /submissions/:id/grade — অ্যাডমিন মার্ক দেবে
//    URL: PATCH /api/v1/assignments/submissions/:id/grade
//    Body: { marks, feedback? }
// ═══════════════════════════════════════════════════════════
assignmentRouter.patch(
  "/submissions/:id/grade",
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const { marks, feedback } = req.body;

      if (marks === undefined || marks === null) {
        throw new AppError("marks is required", 400);
      }

      const submission = await prisma.assignmentSubmission.findUnique({
        where: { id },
        include: {
          assignment: {
            select: { totalMarks: true, title: true },
          },
        },
      });

      if (!submission) {
        throw new AppError("Submission not found", 404);
      }

      if (marks < 0 || marks > submission.assignment.totalMarks) {
        throw new AppError(
          `marks must be between 0 and ${submission.assignment.totalMarks}`,
          400
        );
      }

      const updated = await prisma.assignmentSubmission.update({
        where: { id },
        data: {
          marks,
          feedback: feedback ?? null,
          status: "GRADED",
          gradedAt: new Date(),
        },
      });

      // ── ছাত্রকে notification ──
      await prisma.notification.create({
        data: {
          userId: submission.learnerId,
          type: "ANNOUNCEMENT",
          title: "📊 অ্যাসাইনমেন্ট গ্রেড করা হয়েছে",
          message: `${submission.assignment.title} — আপনি পেয়েছেন ${marks}/${submission.assignment.totalMarks}`,
        },
      });

      sendResponse({
        res,
        message: "Submission graded successfully",
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// ৮. GET /:id/submissions — সব সাবমিশন (অ্যাডমিন)
//    URL: GET /api/v1/assignments/:id/submissions
// ═══════════════════════════════════════════════════════════
assignmentRouter.get("/:id/submissions", async (req, res, next) => {
  try {
    const assignmentId = req.params.id as string;

    const submissions = await prisma.assignmentSubmission.findMany({
      where: { assignmentId },
      orderBy: { submittedAt: "desc" },
      include: {
        learner: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    });

    sendResponse({
      res,
      message: "Submissions fetched successfully",
      data: { submissions, total: submissions.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ৯. GET /my/:learnerId — আমার সব সাবমিশন
//    URL: GET /api/v1/assignments/my/:learnerId
// ═══════════════════════════════════════════════════════════
assignmentRouter.get("/my/:learnerId", async (req, res, next) => {
  try {
    const learnerId = req.params.learnerId as string;

    const submissions = await prisma.assignmentSubmission.findMany({
      where: { learnerId },
      orderBy: { submittedAt: "desc" },
      include: {
        assignment: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            deadline: true,
            module: {
              select: { id: true, title: true, courseId: true },
            },
          },
        },
      },
    });

    sendResponse({
      res,
      message: "My submissions fetched successfully",
      data: { submissions, total: submissions.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// ১০. DELETE /submissions/:id — সাবমিশন ডিলিট
//     URL: DELETE /api/v1/assignments/submissions/:id
// ═══════════════════════════════════════════════════════════
assignmentRouter.delete("/submissions/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.assignmentSubmission.findUnique({
      where: { id },
    });
    if (!exists) throw new AppError("Submission not found", 404);

    await prisma.assignmentSubmission.delete({ where: { id } });

    sendResponse({ res, message: "Submission deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default assignmentRouter;