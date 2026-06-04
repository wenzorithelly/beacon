-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "view" TEXT NOT NULL,
    "cluster" TEXT,
    "title" TEXT NOT NULL,
    "role" TEXT,
    "plain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 2,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "x" REAL NOT NULL DEFAULT 0,
    "y" REAL NOT NULL DEFAULT 0,
    "sourceRef" TEXT,
    "externalId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Node_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Note_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "color" TEXT
);

-- CreateTable
CREATE TABLE "Edge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DEPENDS',
    "label" TEXT,
    CONSTRAINT "Edge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Edge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bug" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sourceRef" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "nodeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bug_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_NodeTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_NodeTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_NodeTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Node_view_idx" ON "Node"("view");

-- CreateIndex
CREATE INDEX "Node_parentId_idx" ON "Node"("parentId");

-- CreateIndex
CREATE INDEX "Node_cluster_idx" ON "Node"("cluster");

-- CreateIndex
CREATE INDEX "Note_nodeId_idx" ON "Note"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_label_key" ON "Tag"("label");

-- CreateIndex
CREATE INDEX "Edge_fromId_idx" ON "Edge"("fromId");

-- CreateIndex
CREATE INDEX "Edge_toId_idx" ON "Edge"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "Edge_fromId_toId_kind_key" ON "Edge"("fromId", "toId", "kind");

-- CreateIndex
CREATE INDEX "Bug_nodeId_idx" ON "Bug"("nodeId");

-- CreateIndex
CREATE INDEX "Bug_severity_idx" ON "Bug"("severity");

-- CreateIndex
CREATE INDEX "Bug_source_externalId_idx" ON "Bug"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "_NodeTags_AB_unique" ON "_NodeTags"("A", "B");

-- CreateIndex
CREATE INDEX "_NodeTags_B_index" ON "_NodeTags"("B");
