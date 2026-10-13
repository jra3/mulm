import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const positiveId = z.number().int().positive();

/** A closed-over parser preserves the relationship between a schema and its handler. */
export function defineTool<S extends z.ZodType>(
  name: string,
  description: string,
  schema: S,
  handler: (args: z.output<S>) => Promise<CallToolResult>
) {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" });
  const definition: Tool = {
    name,
    description,
    inputSchema: ToolSchema.shape.inputSchema.parse({ ...jsonSchema, type: "object" }),
  };
  return {
    definition,
    async call(args: unknown): Promise<CallToolResult> {
      // Omitted arguments mean {}, so optional-only tools retain their defaults.
      // Required fields still fail, null is never coerced, and extra keys are stripped.
      const parsed = schema.safeParse(args === undefined ? {} : args);
      if (!parsed.success) {
        return toolError(
          "INVALID_ARGUMENTS",
          parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
            .join("; ")
        );
      }
      return handler(parsed.data);
    },
  };
}

function toolError(code: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: false, error: message, error_code: code }, null, 2),
      },
    ],
  };
}

export function registerTools(server: Server, tools: ReturnType<typeof defineTool>[]): void {
  const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => tool.definition),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const tool = byName.get(request.params.name);
      if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
      return await tool.call(request.params.arguments);
    } catch (error) {
      return toolError(
        "TOOL_EXECUTION_ERROR",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  });
}
