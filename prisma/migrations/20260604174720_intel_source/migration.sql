-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DbTable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "x" REAL NOT NULL DEFAULT 0,
    "y" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_DbTable" ("createdAt", "description", "domain", "id", "name", "updatedAt", "x", "y") SELECT "createdAt", "description", "domain", "id", "name", "updatedAt", "x", "y" FROM "DbTable";
DROP TABLE "DbTable";
ALTER TABLE "new_DbTable" RENAME TO "DbTable";
CREATE UNIQUE INDEX "DbTable_name_key" ON "DbTable"("name");
CREATE INDEX "DbTable_domain_idx" ON "DbTable"("domain");
CREATE TABLE "new_Endpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "domain" TEXT,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "x" REAL NOT NULL DEFAULT 0,
    "y" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Endpoint" ("createdAt", "description", "domain", "id", "method", "path", "updatedAt", "x", "y") SELECT "createdAt", "description", "domain", "id", "method", "path", "updatedAt", "x", "y" FROM "Endpoint";
DROP TABLE "Endpoint";
ALTER TABLE "new_Endpoint" RENAME TO "Endpoint";
CREATE INDEX "Endpoint_domain_idx" ON "Endpoint"("domain");
CREATE UNIQUE INDEX "Endpoint_method_path_key" ON "Endpoint"("method", "path");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
