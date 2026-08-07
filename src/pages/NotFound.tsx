import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        404
      </h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        页面不存在。
      </p>
      <Link
        to="/"
        className="mt-4 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        返回首页
      </Link>
    </div>
  );
}
