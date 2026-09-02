export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function actionError(
  error: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}
