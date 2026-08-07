import { Suspense } from "react";
import { Link, Navigate, useParams } from "react-router";
import { getToolById } from "../tools/registry";

export default function ToolPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const tool = toolId ? getToolById(toolId) : undefined;

  if (!tool) {
    return <Navigate to="/404" replace />;
  }

  const { Component } = tool;

  return (
    <div>
      <Link
        to="/"
        className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        ← 返回工具列表
      </Link>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-2xl">{tool.icon}</span>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {tool.name}
        </h1>
      </div>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {tool.description}
      </p>

      <div className="mt-6">
        <Suspense fallback={<div className="text-sm text-gray-400">加载中…</div>}>
          <Component />
        </Suspense>
      </div>
    </div>
  );
}
