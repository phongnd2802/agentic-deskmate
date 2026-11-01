"use client";
// Adapted from OpenIntelligentUI table-catalog.tsx (MIT).
import { createCatalog } from "@copilotkit/a2ui-renderer";
import { z } from "zod";

const TableProps = z.object({
  title: z.string(),
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())),
  source: z.string(),
});

function DataTable({ props }: { props: z.infer<typeof TableProps> }) {
  const { title, columns, rows, source } = props;
  return (
    <section data-testid="a2ui-table">
      <table border={1}>
        <caption>{title}</caption>
        <thead><tr>{columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
      <small>{source}</small>
    </section>
  );
}

export const tableCatalog = createCatalog(
  { Table: { props: TableProps, description: "A data table. Every row must match the columns." } },
  { Table: DataTable },
  { catalogId: "copilotkit://deskmate-tables" },
);
