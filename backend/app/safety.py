from __future__ import annotations

import ast


ALLOWED_IMPORTS = {
    "pandas",
    "polars",
    "numpy",
    "scipy",
    "sklearn",
    "pyarrow",
    "duckdb",
    "json",
    "re",
    "datetime",
    "pathlib",
    "math",
    "hashlib",
    "joblib",
    "time",
}

BLOCKED_NAMES = {"eval", "exec", "compile", "__import__", "input", "globals", "locals", "vars"}
BLOCKED_MODULES = {
    "os",
    "subprocess",
    "socket",
    "requests",
    "urllib",
    "shutil",
    "pickle",
    "multiprocessing",
    "ctypes",
    "importlib",
    "sys",
}
BLOCKED_ATTRS = {"system", "popen", "rmtree", "remove", "unlink", "rmdir", "run", "Popen"}


class SafetyVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.errors: list[str] = []

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root in BLOCKED_MODULES or root not in ALLOWED_IMPORTS:
                self.errors.append(f"Import '{alias.name}' is not allowed.")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        root = (node.module or "").split(".")[0]
        if root in BLOCKED_MODULES or root not in ALLOWED_IMPORTS:
            self.errors.append(f"Import from '{node.module}' is not allowed.")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in BLOCKED_NAMES:
            self.errors.append(f"Call to '{node.func.id}' is blocked.")
        if isinstance(node.func, ast.Name) and node.func.id == "open":
            self._validate_open(node)
        if isinstance(node.func, ast.Attribute):
            if node.func.attr in BLOCKED_ATTRS:
                self.errors.append(f"Call to '*.{node.func.attr}' is blocked.")
        self.generic_visit(node)

    def _validate_open(self, node: ast.Call) -> None:
        if not node.args:
            self.errors.append("open() requires an explicit approved path.")
            return
        arg = node.args[0]
        allowed = False
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            allowed = arg.value.startswith("/input/") or arg.value.startswith("/output/")
        elif isinstance(arg, ast.Name) and arg.id in {"INPUT_PATH", "OUTPUT_DIR"}:
            allowed = True
        elif isinstance(arg, ast.BinOp):
            allowed = True
        if not allowed:
            self.errors.append("open() may only access approved input or output paths.")


def validate_python_code(code: str) -> list[str]:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return [f"Syntax error: {exc}"]
    visitor = SafetyVisitor()
    visitor.visit(tree)
    return visitor.errors
