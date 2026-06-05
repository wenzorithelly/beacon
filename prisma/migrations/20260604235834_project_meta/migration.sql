-- CreateTable
CREATE TABLE "ProjectMeta" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "overview" TEXT,
    "conventions" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL
);
