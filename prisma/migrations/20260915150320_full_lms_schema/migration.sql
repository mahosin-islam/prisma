/*
  Warnings:

  - The values [THEORY,CODING] on the enum `LessonType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `categoryId` on the `courses` table. All the data in the column will be lost.
  - You are about to drop the column `chapterId` on the `lessons` table. All the data in the column will be lost.
  - You are about to drop the `categories` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `chapters` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[learnerId,courseId,batchId]` on the table `enrollments` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `moduleId` to the `lessons` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CourseType" AS ENUM ('FIXED', 'BATCH');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_LESSON', 'NEW_ASSIGNMENT', 'NEW_LIVE_CLASS', 'ANNOUNCEMENT', 'COURSE_COMPLETED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'GRADED');

-- AlterEnum
BEGIN;
CREATE TYPE "LessonType_new" AS ENUM ('VIDEO', 'TEXT', 'QUIZ');
ALTER TABLE "public"."lessons" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "lessons" ALTER COLUMN "type" TYPE "LessonType_new" USING ("type"::text::"LessonType_new");
ALTER TYPE "LessonType" RENAME TO "LessonType_old";
ALTER TYPE "LessonType_new" RENAME TO "LessonType";
DROP TYPE "public"."LessonType_old";
ALTER TABLE "lessons" ALTER COLUMN "type" SET DEFAULT 'VIDEO';
COMMIT;

-- DropForeignKey
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_moduleId_fkey";

-- DropForeignKey
ALTER TABLE "courses" DROP CONSTRAINT "courses_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_chapterId_fkey";

-- DropIndex
DROP INDEX "courses_categoryId_idx";

-- DropIndex
DROP INDEX "enrollments_learnerId_courseId_key";

-- DropIndex
DROP INDEX "lessons_chapterId_idx";

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "categoryId",
ADD COLUMN     "courseType" "CourseType" NOT NULL DEFAULT 'FIXED';

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "lessons" DROP COLUMN "chapterId",
ADD COLUMN     "availableAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "duration" INTEGER,
ADD COLUMN     "moduleId" TEXT NOT NULL,
ADD COLUMN     "thumbnail" TEXT,
ALTER COLUMN "type" SET DEFAULT 'VIDEO';

-- AlterTable
ALTER TABLE "modules" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "intro" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "batchId" TEXT;

-- DropTable
DROP TABLE "categories";

-- DropTable
DROP TABLE "chapters";

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "title" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'UPCOMING',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "meetingLink" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 60,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "docUrl" TEXT,
    "deadline" TIMESTAMP(3),
    "totalMarks" INTEGER NOT NULL DEFAULT 100,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "answerUrl" TEXT NOT NULL,
    "note" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "marks" INTEGER,
    "feedback" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "certificateCode" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "batchId" TEXT,
    "learnerName" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "batchName" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batches_courseId_idx" ON "batches"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "batches_courseId_batchNumber_key" ON "batches"("courseId", "batchNumber");

-- CreateIndex
CREATE INDEX "live_sessions_batchId_idx" ON "live_sessions"("batchId");

-- CreateIndex
CREATE INDEX "live_sessions_scheduledAt_idx" ON "live_sessions"("scheduledAt");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_batchId_idx" ON "notifications"("batchId");

-- CreateIndex
CREATE INDEX "assignments_moduleId_idx" ON "assignments"("moduleId");

-- CreateIndex
CREATE INDEX "assignment_submissions_assignmentId_idx" ON "assignment_submissions"("assignmentId");

-- CreateIndex
CREATE INDEX "assignment_submissions_learnerId_idx" ON "assignment_submissions"("learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignmentId_learnerId_key" ON "assignment_submissions"("assignmentId", "learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificateCode_key" ON "certificates"("certificateCode");

-- CreateIndex
CREATE INDEX "certificates_learnerId_idx" ON "certificates"("learnerId");

-- CreateIndex
CREATE INDEX "certificates_courseId_idx" ON "certificates"("courseId");

-- CreateIndex
CREATE INDEX "enrollments_batchId_idx" ON "enrollments"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_learnerId_courseId_batchId_key" ON "enrollments"("learnerId", "courseId", "batchId");

-- CreateIndex
CREATE INDEX "lessons_moduleId_idx" ON "lessons"("moduleId");

-- CreateIndex
CREATE INDEX "modules_batchId_idx" ON "modules"("batchId");

-- CreateIndex
CREATE INDEX "orders_batchId_idx" ON "orders"("batchId");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
