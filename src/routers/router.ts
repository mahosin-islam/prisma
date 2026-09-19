import { Router } from "express";
import authRouter from "../services/auth.js";
import userRouter from "../services/users.js";
import courseRouter from "../services/courses.js";
import batchRouter from "../services/batches.js";
import moduleRouter from "../services/modules.js";
import lessonRouter from "../services/lessons.js";
import quizRouter from "../services/quizzes.js";
import enrollmentRouter from "../services/enrollments.js";
import paymentRouter from "../services/payments.js";
import progressRouter from "../services/progress.js";
import notificationRouter from "../services/notifications.js";
import liveSessionRouter from "../services/liveSessions.js";
import assignmentRouter from "../services/assignments.js";
import certificateRouter from "../services/certificates.js";
import dashboardRouter from "../services/dashboard.js";
import reviewRouter from "../services/reviews.js";



const router = Router();


router.use("/auth", authRouter);
router.use("/users", userRouter);
router.use("/courses", courseRouter);
router.use("/batches", batchRouter);
router.use("/modules", moduleRouter);
router.use("/lessons", lessonRouter);
router.use("/quizzes", quizRouter);
router.use("/enrollments", enrollmentRouter);
router.use("/payments", paymentRouter); 
router.use("/progress", progressRouter);
router.use("/notifications", notificationRouter);
router.use("/live-sessions", liveSessionRouter);
router.use("/assignments", assignmentRouter);
router.use("/certificates", certificateRouter);
router.use("/dashboard", dashboardRouter);
router.use("/reviews", reviewRouter);

export default router;