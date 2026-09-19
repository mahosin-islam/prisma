import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../utils/AppError.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { roleMiddleware } from "../middlewares/role.middleware.js";

const quizRouter = Router();

quizRouter.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// 1. POST / — Create a quiz question (ADMIN only)
//    Body: { lessonId, question, options, correctAnswer, order }
// ═══════════════════════════════════════════════════════════
quizRouter.post("/", roleMiddleware("ADMIN"), async (req, res, next) => {
  try {
    const { lessonId, question, options, correctAnswer, order } = req.body;

    if (!lessonId || !question || !options || !correctAnswer) {
      throw new AppError("lessonId, question, options, and correctAnswer are required", 400);
    }

    if (!Array.isArray(options) || options.length < 2) {
      throw new AppError("options must be an array with at least 2 items", 400);
    }

    if (!options.includes(correctAnswer)) {
      throw new AppError("correctAnswer must be one of the options", 400);
    }

    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson || lesson.isDeleted) {
      throw new AppError("Lesson not found", 404);
    }

    if (lesson.type !== "QUIZ") {
      throw new AppError("Quizzes can only be added to QUIZ type lessons", 400);
    }

    let finalOrder = order;
    if (finalOrder === undefined) {
      const count = await prisma.quiz.count({ where: { lessonId } });
      finalOrder = count + 1;
    }

    const quiz = await prisma.quiz.create({
      data: { lessonId, question, options, correctAnswer, order: finalOrder },
    });

    sendResponse({
      res,
      statusCode: 201,
      message: "Quiz created successfully",
      data: quiz,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 2. POST /bulk — Create multiple quizzes at once (ADMIN only)
//    Body: { lessonId, quizzes: [{ question, options, correctAnswer, order }] }
// ═══════════════════════════════════════════════════════════
quizRouter.post("/bulk", roleMiddleware("ADMIN"), async (req, res, next) => {
  try {
    const { lessonId, quizzes } = req.body;

    if (!lessonId || !Array.isArray(quizzes) || quizzes.length === 0) {
      throw new AppError("lessonId and quizzes array are required", 400);
    }

    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson || lesson.isDeleted) {
      throw new AppError("Lesson not found", 404);
    }

    if (lesson.type !== "QUIZ") {
      throw new AppError("Quizzes can only be added to QUIZ type lessons", 400);
    }

    for (let i = 0; i < quizzes.length; i++) {
      const q = quizzes[i];
      if (!q.question || !q.options || !q.correctAnswer) {
        throw new AppError(`Quiz ${i + 1}: question, options, correctAnswer are required`, 400);
      }
      if (!Array.isArray(q.options) || q.options.length < 2) {
        throw new AppError(`Quiz ${i + 1}: options must have at least 2 items`, 400);
      }
      if (!q.options.includes(q.correctAnswer)) {
        throw new AppError(`Quiz ${i + 1}: correctAnswer must be one of the options`, 400);
      }
    }

    const existingCount = await prisma.quiz.count({ where: { lessonId } });

    const result = await prisma.quiz.createMany({
      data: quizzes.map((q, idx) => ({
        lessonId,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        order: q.order ?? existingCount + idx + 1,
      })),
    });

    const all = await prisma.quiz.findMany({
      where: { lessonId },
      orderBy: { order: "asc" },
    });

    sendResponse({
      res,
      statusCode: 201,
      message: `${result.count} quizzes created successfully`,
      data: { count: result.count, quizzes: all },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 3. GET /lesson/:lessonId — Get all quizzes for a lesson
// ═══════════════════════════════════════════════════════════
quizRouter.get("/lesson/:lessonId", async (req, res, next) => {
  try {
    const lessonId = req.params.lessonId as string;

    const quizzes = await prisma.quiz.findMany({
      where: { lessonId },
      orderBy: { order: "asc" },
    });

    sendResponse({
      res,
      message: "Quizzes fetched successfully",
      data: { quizzes, total: quizzes.length },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 4. GET /lesson/:lessonId/my-attempts/:learnerId
// ═══════════════════════════════════════════════════════════
quizRouter.get(
  "/lesson/:lessonId/my-attempts/:learnerId",
  async (req, res, next) => {
    try {
      const lessonId = req.params.lessonId as string;
      const learnerId = req.params.learnerId as string;

      const quizzes = await prisma.quiz.findMany({ where: { lessonId } });
      const quizIds = quizzes.map((q) => q.id);

      const attempts = await prisma.quizAttempt.findMany({
        where: { learnerId, quizId: { in: quizIds } },
        orderBy: { createdAt: "desc" },
      });

      const correctCount = attempts.filter((a) => a.isCorrect).length;

      sendResponse({
        res,
        message: "Attempts fetched successfully",
        data: {
          totalQuizzes: quizzes.length,
          totalAttempts: attempts.length,
          correctAnswers: correctCount,
          attempts,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// 5. GET /:id — Get a single quiz
// ═══════════════════════════════════════════════════════════
quizRouter.get("/:id", async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const quiz = await prisma.quiz.findUnique({
      where: { id },
      include: {
        lesson: { select: { id: true, title: true, moduleId: true } },
      },
    });

    if (!quiz) throw new AppError("Quiz not found", 404);

    sendResponse({
      res,
      message: "Quiz fetched successfully",
      data: quiz,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 6. PATCH /:id — Update a quiz (ADMIN only)
// ═══════════════════════════════════════════════════════════
quizRouter.patch("/:id", roleMiddleware("ADMIN"), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const { question, options, correctAnswer, order } = req.body;

    const exists = await prisma.quiz.findUnique({ where: { id } });
    if (!exists) throw new AppError("Quiz not found", 404);

    const finalOptions = options ?? (exists.options as string[]);
    const finalCorrect = correctAnswer ?? exists.correctAnswer;

    if (!finalOptions.includes(finalCorrect)) {
      throw new AppError("correctAnswer must be one of the options", 400);
    }

    const quiz = await prisma.quiz.update({
      where: { id },
      data: {
        ...(question && { question }),
        ...(options && { options }),
        ...(correctAnswer && { correctAnswer }),
        ...(order !== undefined && { order }),
      },
    });

    sendResponse({
      res,
      message: "Quiz updated successfully",
      data: quiz,
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 7. DELETE /:id — Hard delete a quiz (ADMIN only)
//    Note: Quiz model has no isDeleted field, so hard delete is intended.
// ═══════════════════════════════════════════════════════════
quizRouter.delete("/:id", roleMiddleware("ADMIN"), async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const exists = await prisma.quiz.findUnique({ where: { id } });
    if (!exists) throw new AppError("Quiz not found", 404);

    await prisma.quiz.delete({ where: { id } });

    sendResponse({ res, message: "Quiz deleted successfully" });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 8. POST /:id/attempt — Submit an answer to a single quiz
//    Body: { learnerId, selectedAnswer }
// ═══════════════════════════════════════════════════════════
quizRouter.post("/:id/attempt", async (req, res, next) => {
  try {
    const quizId = req.params.id as string;
    const { learnerId, selectedAnswer } = req.body;

    if (!learnerId || !selectedAnswer) {
      throw new AppError("learnerId and selectedAnswer are required", 400);
    }

    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new AppError("Quiz not found", 404);

    const isCorrect = quiz.correctAnswer === selectedAnswer;

    const attempt = await prisma.quizAttempt.create({
      data: { learnerId, quizId, selectedAnswer, isCorrect },
    });

    sendResponse({
      res,
      statusCode: 201,
      message: isCorrect ? "Correct answer!" : "Wrong answer",
      data: { attempt, isCorrect, correctAnswer: quiz.correctAnswer },
    });
  } catch (error) {
    next(error);
  }
});

// ═══════════════════════════════════════════════════════════
// 9. POST /lesson/:lessonId/submit — Submit entire quiz
//    Body: { learnerId, answers: [{ quizId, selectedAnswer }] }
// ═══════════════════════════════════════════════════════════
quizRouter.post("/lesson/:lessonId/submit", async (req, res, next) => {
  try {
    const lessonId = req.params.lessonId as string;
    const { learnerId, answers } = req.body;

    if (!learnerId || !Array.isArray(answers)) {
      throw new AppError("learnerId and answers array are required", 400);
    }

    const quizzes = await prisma.quiz.findMany({ where: { lessonId } });
    if (quizzes.length === 0) {
      throw new AppError("No quizzes found for this lesson", 404);
    }

    const results = [];
    let correctCount = 0;

    for (const ans of answers) {
      const quiz = quizzes.find((q) => q.id === ans.quizId);
      if (!quiz) continue;

      const isCorrect = quiz.correctAnswer === ans.selectedAnswer;
      if (isCorrect) correctCount++;

      await prisma.quizAttempt.create({
        data: {
          learnerId,
          quizId: ans.quizId,
          selectedAnswer: ans.selectedAnswer,
          isCorrect,
        },
      });

      results.push({
        quizId: ans.quizId,
        question: quiz.question,
        yourAnswer: ans.selectedAnswer,
        correctAnswer: quiz.correctAnswer,
        isCorrect,
      });
    }

    const total = quizzes.length;
    const percentage = Math.round((correctCount / total) * 100);

    sendResponse({
      res,
      message: "Quiz submitted successfully",
      data: {
        total,
        correct: correctCount,
        wrong: total - correctCount,
        percentage,
        results,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default quizRouter;