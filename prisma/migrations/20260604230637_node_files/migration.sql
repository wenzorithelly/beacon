-- CreateTable
CREATE TABLE "NodeFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nodeId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    CONSTRAINT "NodeFile_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "NodeFile_nodeId_idx" ON "NodeFile"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeFile_nodeId_path_key" ON "NodeFile"("nodeId", "path");
