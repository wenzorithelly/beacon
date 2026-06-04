-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "intelModel" TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
    "intelProvider" TEXT NOT NULL DEFAULT 'auto',
    "editor" TEXT NOT NULL DEFAULT 'auto',
    "currentFeatureId" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSetting" ("id", "intelModel", "intelProvider", "updatedAt") SELECT "id", "intelModel", "intelProvider", "updatedAt" FROM "AppSetting";
DROP TABLE "AppSetting";
ALTER TABLE "new_AppSetting" RENAME TO "AppSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
