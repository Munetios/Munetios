import { tmpdir } from "node:os";
import { join } from "node:path";

const isServerlessRuntime = Boolean(
  process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT,
);

export const dataDirectory =
  process.env.MUNETIOS_DATA_DIR ||
  (isServerlessRuntime
    ? join(tmpdir(), "munetios-data")
    : join(process.cwd(), "data"));
