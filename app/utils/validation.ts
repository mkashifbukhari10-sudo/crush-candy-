import { z } from "zod";

export class InputValidationError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(error: z.ZodError) {
    super("Input validation failed");
    this.name = "InputValidationError";
    this.issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
  }
}

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) throw new InputValidationError(result.error);
  return result.data;
}

