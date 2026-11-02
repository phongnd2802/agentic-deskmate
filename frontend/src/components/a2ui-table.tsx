"use client";

import { A2UIProvider, A2UIRenderer, createCatalog, useA2UIActions, viewerTheme } from "@copilotkit/a2ui-renderer";
import { useEffect, useMemo } from "react";
import { z } from "zod";

import { TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const CATALOG_ID = "copilotkit://deskmate-tables";

// The backend's A2uiArgs says the same. No component here has an action: an A2UI action would start a run.
const TableProps = z.object({ title: z.string().min(1), columns: z.array(z.string()).min(1), rows: z.array(z.array(z.string())) });

function DataTable({ props: { title, columns, rows } }: { props: z.infer<typeof TableProps> }) {
  // The scroll container is ours, not shadcn's Table wrapper, so that it can take focus and scroll from the keyboard.
  return (
    <div role="region" aria-label={title} tabIndex={0} className="w-full overflow-x-auto rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      <table className="w-full caption-top text-sm">
        <TableCaption className="mt-0 mb-2 text-left font-medium text-foreground">{title}</TableCaption>
        <TableHeader>
          <TableRow>
            {columns.map((column, i) => (
              <TableHead key={i} scope="col">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => (
                <TableCell key={j}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}

/** The custom catalog: one Table. Registered on the provider for live Answers and used by StoredTable on reopen. */
export const tableCatalog = createCatalog({ Table: { props: TableProps, description: "A data table. Every row has one string per column." } }, { Table: DataTable }, { catalogId: CATALOG_ID });

function Feed({ surfaceId, components }: { surfaceId: string; components: unknown[] }) {
  const { processMessages } = useA2UIActions();
  useEffect(() => {
    processMessages([
      { version: "v0.9", createSurface: { surfaceId, catalogId: CATALOG_ID } },
      { version: "v0.9", updateComponents: { surfaceId, components } },
    ]);
  }, [surfaceId, components, processMessages]);
  return null;
}

/** A stored table, rendered with no agent run. Null when the arguments are partial or not a table. */
export function StoredTable({ args }: { args: string }) {
  const parsed = useMemo(() => {
    try {
      const { surfaceId, components } = JSON.parse(args);
      // The backend validated these before storing them; this keeps a truncated or foreign row from rendering as a blank surface.
      const table = z.object({ id: z.literal("root"), component: z.literal("Table") }).extend(TableProps.shape);
      return { surfaceId: z.string().min(1).parse(surfaceId), components: z.array(table).length(1).parse(components) };
    } catch {
      return null;
    }
  }, [args]);
  if (!parsed) return null;
  return (
    // onAction does nothing: reopening is read-only.
    <A2UIProvider theme={viewerTheme} catalog={tableCatalog} onAction={() => {}}>
      <Feed {...parsed} />
      <A2UIRenderer surfaceId={parsed.surfaceId} />
    </A2UIProvider>
  );
}
