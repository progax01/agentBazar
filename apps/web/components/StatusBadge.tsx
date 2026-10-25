import clsx from "clsx";
import { APP_STATUS_LABELS, type AppStatusType } from "@agetbazar/shared";

const colors: Record<AppStatusType, string> = {
  creating:           "bg-gray-700 text-gray-200",
  funded:             "bg-blue-900 text-blue-200",
  processing:         "bg-yellow-900 text-yellow-200",
  submitted:          "bg-purple-900 text-purple-200",
  verifying:          "bg-indigo-900 text-indigo-200",
  verification_error: "bg-orange-900 text-orange-200",
  paid:               "bg-green-900 text-green-200",
  refunded:           "bg-gray-700 text-gray-300",
  failed:             "bg-red-900 text-red-200",
};

export function StatusBadge({ status }: { status: AppStatusType }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        colors[status],
      )}
    >
      {APP_STATUS_LABELS[status]}
    </span>
  );
}
