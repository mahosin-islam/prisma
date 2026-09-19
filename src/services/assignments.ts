import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const assignmentRouter = Router();

assignmentRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// 1. POST / — Create assignment (ADMIN only)
//    Body: { moduleId, title, description?, docUrl?,
//            deadline?, totalMarks?, notifyStudents? }
// ═══════════════════════════════════════════════════════════
assignmentRouter.post(
  "/",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
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

      // Send notifications to enrolled students
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
              title: "New Assignment",
              message: `${title} — Deadline: ${deadline ?? "No deadline"}`,
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
  }
);

// ═══════════════════════════════════════════════════════════
// 2. PATCH /submissions/:id/grade — Grade a submission (ADMIN only)
//    Body: { marks, feedback? }
//    ⚠️ Must come BEFORE /:id routes
// ═══════════════════════════════════════════════════════════
assignmentRouter.patch(
  "/submissions/:id/grade",
  roleMiddleware("ADMIN"),
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
          assignment: { select: { totalMarks: true, title: true } },
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

      // Notify the learner
      await prisma.notification.create({
        data: {
          userId: submission.learnerId,
          type: "ANNOUNCEMENT",
          title: "Assignment Graded",
          message: `${submission.assignment.title} — You scored ${marks}/${submission.assignment.totalMarks}`,
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
// 3. DELETE /submissions/:id — Delete a submission (ADMIN only)
// ═══════════════════════════════════════════════════════════
assignmentRouter.delete(
  "/submissions/:id",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
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
  }
);

// ═══════════════════════════════════════════════════════════
// 4. GET /module/:moduleId — Get all assignments of a module
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
// 5. GET /my/:learnerId — Get all submissions of a learner
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
            module: { select: { id: true, title: true, courseId: true } },
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
// 6. GET /:id/submissions — Get all submissions (ADMIN only)
// ═══════════════════════════════════════════════════════════
assignmentRouter.get(
  "/:id/submissions",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
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
  }
);

// ═══════════════════════════════════════════════════════════
// 7. PATCH /:id — Update an assignment (ADMIN only)
// ═══════════════════════════════════════════════════════════
assignmentRouter.patch(
  "/:id",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
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
  }
);

// ═══════════════════════════════════════════════════════════
// 8. DELETE /:id — Soft delete an assignment (ADMIN only)
// ═══════════════════════════════════════════════════════════
assignmentRouter.delete(
  "/:id",
  roleMiddleware("ADMIN"),
  async (req, res, next) => {
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
  }
);

// ═══════════════════════════════════════════════════════════
// 9. POST /:id/submit — Learner submits an assignment
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

    // Check enrollment
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

    // Check deadline
    if (assignment.deadline && new Date() > assignment.deadline) {
      throw new AppError("Deadline has passed", 400);
    }

    // Prevent duplicate submission
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
// 10. GET /:id — Get a single assignment
//     ⚠️ Must be LAST to avoid matching other routes
// ═══════════════════════════════════════════════════════════
assignmentRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        module: {
          select: { id: true, title: true, courseId: true, batchId: true },
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

export default assignmentRouter;