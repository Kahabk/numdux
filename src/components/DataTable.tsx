import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef
} from "@tanstack/react-table";

export function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns: ColumnDef<Record<string, unknown>>[] = Object.keys(rows[0] ?? {}).map((key) => ({
    accessorKey: key,
    header: key,
    cell: ({ getValue }) => {
      const value = getValue();
      if (value == null) return <span className="text-muted">null</span>;
      return <span>{String(value)}</span>;
    }
  }));
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  if (!rows.length) {
    return <div className="text-sm text-muted">No rows to preview.</div>;
  }

  return (
    <div className="max-h-72 overflow-auto border border-line">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-panel text-muted">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} className="whitespace-nowrap border-b border-line px-2 py-2 font-medium">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="odd:bg-base/20 hover:bg-panel/70">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="max-w-52 truncate border-b border-line/60 px-2 py-1.5 font-mono">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

