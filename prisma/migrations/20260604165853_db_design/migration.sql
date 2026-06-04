-- CreateTable
CREATE TABLE "DbTable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "description" TEXT,
    "x" REAL NOT NULL DEFAULT 0,
    "y" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DbColumn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isPk" BOOLEAN NOT NULL DEFAULT false,
    "isFk" BOOLEAN NOT NULL DEFAULT false,
    "nullable" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "ord" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DbColumn_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DbTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DbRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromTableId" TEXT NOT NULL,
    "toTableId" TEXT NOT NULL,
    "fromColumn" TEXT NOT NULL,
    "toColumn" TEXT NOT NULL,
    "label" TEXT,
    CONSTRAINT "DbRelation_fromTableId_fkey" FOREIGN KEY ("fromTableId") REFERENCES "DbTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DbRelation_toTableId_fkey" FOREIGN KEY ("toTableId") REFERENCES "DbTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "domain" TEXT,
    "description" TEXT,
    "x" REAL NOT NULL DEFAULT 0,
    "y" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EndpointTable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpointId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'read',
    CONSTRAINT "EndpointTable_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EndpointTable_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DbTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DbTable_name_key" ON "DbTable"("name");

-- CreateIndex
CREATE INDEX "DbTable_domain_idx" ON "DbTable"("domain");

-- CreateIndex
CREATE INDEX "DbColumn_tableId_idx" ON "DbColumn"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "DbColumn_tableId_name_key" ON "DbColumn"("tableId", "name");

-- CreateIndex
CREATE INDEX "DbRelation_fromTableId_idx" ON "DbRelation"("fromTableId");

-- CreateIndex
CREATE INDEX "DbRelation_toTableId_idx" ON "DbRelation"("toTableId");

-- CreateIndex
CREATE INDEX "Endpoint_domain_idx" ON "Endpoint"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Endpoint_method_path_key" ON "Endpoint"("method", "path");

-- CreateIndex
CREATE INDEX "EndpointTable_tableId_idx" ON "EndpointTable"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "EndpointTable_endpointId_tableId_key" ON "EndpointTable"("endpointId", "tableId");
