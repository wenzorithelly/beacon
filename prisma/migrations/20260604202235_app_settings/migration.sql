-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "intelModel" TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
    "intelProvider" TEXT NOT NULL DEFAULT 'auto',
    "updatedAt" DATETIME NOT NULL
);
