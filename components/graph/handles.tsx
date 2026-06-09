"use client";

import { Handle, Position } from "@xyflow/react";

// Shared Figma-style connection-dot ring used on every node type. Renders 8 React
// Flow handles (source+target stacked at top/right/bottom/left) so any side can act
// as either end of a connection. The dots are invisible until the node is hovered or
// a connection drag is in progress — see `.react-flow__handle` rules in globals.css.
//
// Handle ids stay stable so existing edge wiring keeps working:
//   • Roadmap CONTAINS edges anchor parent.sb → child.tt
//   • /db FK relations + endpoint→table links keep using sl/tl/sr/tr via `sides()`
export function FourDotHandles() {
  const cls = "!h-2 !w-2 !border-0 !bg-zinc-400";
  return (
    <>
      <Handle type="target" position={Position.Top} id="tt" className={cls} />
      <Handle type="source" position={Position.Top} id="st" className={cls} />
      <Handle type="target" position={Position.Right} id="tr" className={cls} />
      <Handle type="source" position={Position.Right} id="sr" className={cls} />
      <Handle type="target" position={Position.Bottom} id="tb" className={cls} />
      <Handle type="source" position={Position.Bottom} id="sb" className={cls} />
      <Handle type="target" position={Position.Left} id="tl" className={cls} />
      <Handle type="source" position={Position.Left} id="sl" className={cls} />
    </>
  );
}
