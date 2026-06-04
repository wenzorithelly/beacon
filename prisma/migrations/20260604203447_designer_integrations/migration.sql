-- CreateTable
CREATE TABLE "DraftTable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "description" TEXT,
    "x" REAL NOT NULL DEFAULT 0,
    "y" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DraftColumn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isPk" BOOLEAN NOT NULL DEFAULT false,
    "isFk" BOOLEAN NOT NULL DEFAULT false,
    "nullable" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "ord" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DraftColumn_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DraftTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DraftRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromTableId" TEXT NOT NULL,
    "toTableId" TEXT NOT NULL,
    "fromColumn" TEXT NOT NULL,
    "toColumn" TEXT NOT NULL,
    "label" TEXT,
    CONSTRAINT "DraftRelation_fromTableId_fkey" FOREIGN KEY ("fromTableId") REFERENCES "DraftTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DraftRelation_toTableId_fkey" FOREIGN KEY ("toTableId") REFERENCES "DraftTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DraftTable_name_key" ON "DraftTable"("name");

-- CreateIndex
CREATE INDEX "DraftColumn_tableId_idx" ON "DraftColumn"("tableId");

-- CreateIndex
CREATE INDEX "DraftRelation_fromTableId_idx" ON "DraftRelation"("fromTableId");

-- CreateIndex
CREATE INDEX "DraftRelation_toTableId_idx" ON "DraftRelation"("toTableId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_key_key" ON "Integration"("key");
