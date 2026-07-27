import { memo, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef
} from "@tanstack/react-table";

export const DataTable = memo(function DataTable({ rows, pageSize = 20 }: { rows: Record<string, unknown>[]; pageSize?: number }) {
  const [pageIndex, setPageIndex] = useState(0);

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0] ?? {}).map((key) => ({
      accessorKey: key,
      header: key,
      cell: ({ getValue }) => {
        const value = getValue();
        if (value == null) return <span className="text-muted">null</span>;
        return <span>{String(value)}</span>;
      }
    }));
  }, [rows]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize,
        pageIndex: 0
      }
    }
  });

  if (!rows.length) {
    return <div className="text-sm text-muted">No rows to preview.</div>;
  }

  const pageCount = table.getPageCount();

  return (
    <div className="space-y-2">
      <div className="max-h-72 overflow-auto border border-line">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-panel text-muted z-10">
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
      {pageCount > 1 && (
        <div className="flex items-center justify-between px-1 text-xs text-muted">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {pageCount} ({rows.length} total rows)
          </span>
          <div className="flex items-center space-x-1">
            <button
              type="button"
              className="px-2 py-1 border border-line rounded disabled:opacity-40"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </button>
            <button
              type="button"
              className="px-2 py-1 border border-line rounded disabled:opacity-40"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
